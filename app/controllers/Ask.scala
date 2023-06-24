package controllers

import play.api.data.Form
import play.api.data.Forms.single
import views.*

import lila.app.{ given, * }
import lila.ask.Ask.anonHash
import lila.security.{ Granter, Permission }

final class Ask(env: Env) extends LilaController(env):

  def view(aid: String, view: Option[String], tally: Boolean)(using Context) = Open:
    env.ask.api.get(aid).flatMap {
      case Some(ask) => Ok.page(html.ask.renderOne(ask, paramToList(view), tally))
      case None      => fuccess(NotFound(s"Ask $aid not found"))
    }

  def picks(aid: String, picks: Option[String], view: Option[String], anon: Boolean)(using Context) =
    Open {
      effectiveId(aid, anon).flatMap:
        case Some(id) =>
          env.ask.api
            .setPicks(aid, id, paramToList(picks))
            .map:
              case Some(ask) => Ok(html.ask.renderOne(ask, paramToList(view)))
              case None      => NotFound(s"Ask $aid not found")
        case None => authenticationFailed
    }

  def feedback(aid: String, view: Option[String], anon: Boolean)(using Context) = OpenBody:
    effectiveId(aid, anon).flatMap:
      case Some(id) =>
        env.ask.api
          .setFeedback(aid, id, feedbackForm.bindFromRequest().value)
          .map:
            case Some(ask) => Ok(html.ask.renderOne(ask, paramToList(view)))
            case None      => NotFound(s"Ask $aid not found")
      case None => authenticationFailed

  def unset(aid: String, view: Option[String], anon: Boolean)(using Context) = Open:
    effectiveId(aid, anon).flatMap:
      case Some(id) =>
        env.ask.api
          .unset(aid, id)
          .map:
            case Some(ask) => Ok(html.ask.renderOne(ask, paramToList(view)))
            case None      => NotFound(s"Ask $aid not found")
      case None => authenticationFailed

  def admin(aid: String)(using Context) = Auth { _ ?=> _ ?=>
    env.ask.api
      .get(aid)
      .map:
        case Some(ask) => Ok(html.askAdmin.renderOne(ask))
        case None      => NotFound(s"Ask $aid not found")
  }
  def byUser(username: UserStr)(using PageContext) = Auth { _ ?=> _ ?=>
    for
      user <- env.user.lightUser(username.id)
      asks <- env.ask.api.byUser(username.id)
      if user.nonEmpty
    yield Ok(html.askAdmin.show(asks, user.get))
  }
  def json(aid: String) = Auth { _ ?=> me ?=>
    env.ask.api
      .get(aid)
      .map:
        case Some(ask) =>
          if (me is ask.creator) || Granter(Permission.Shusher)(using me) then JsonOk(ask.toJson)
          else JsonBadRequest(jsonError(s"Not authorized to view ask $aid"))
        case None => JsonBadRequest(jsonError(s"Ask $aid not found"))
  }
  def delete(aid: String)(using Context) = Auth { _ ?=> me ?=>
    env.ask.api
      .get(aid)
      .map:
        case None => NotFound(s"Ask id ${aid} not found")
        case Some(ask) =>
          if (me is ask.creator) || Granter(Permission.Shusher)(using me) then
            env.ask.api.delete(aid)
            Ok(lila.ask.AskApi.askNotFoundFrag)
          else Unauthorized

  }

  def conclude(aid: String)(using Context) = authorizedAction(aid, env.ask.api.conclude)

  def reset(aid: String)(using Context) = authorizedAction(aid, env.ask.api.reset)

  private def effectiveId(aid: String, anon: Boolean)(using ctx: Context) =
    ctx.myId match
      case Some(u) => fuccess((if anon then anonHash(u.toString, aid) else u.toString).some)
      case None =>
        env.ask.api
          .isOpen(aid)
          .map:
            case true  => anonHash(ctx.ip.toString, aid).some
            case false => None

  private def authorizedAction(aid: String, action: lila.ask.Ask => Fu[Option[lila.ask.Ask]])(using
      Context
  ) =
    AuthBody { ctx ?=> me ?=>
      env.ask.api
        .get(aid)
        .flatMap:
          case None => fuccess(NotFound(s"Ask id ${aid} not found"))
          case Some(ask) =>
            if (me is ask.creator) || Granter(Permission.Shusher) then
              action(ask).map:
                case Some(newAsk) => Ok(html.ask.renderOne(newAsk))
                case None         => NotFound(s"Ask id ${aid} not found")
            else fuccess(Unauthorized)
    }

  private def paramToList(param: Option[String]) =
    param map (_ split ('-') filter (_ nonEmpty) map (_ toInt) toList)

  private val feedbackForm =
    Form[String](single("text" -> lila.common.Form.cleanNonEmptyText(maxLength = 80)))
