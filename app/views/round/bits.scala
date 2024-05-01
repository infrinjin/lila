package views.round

import scala.util.chaining.*
import chess.variant.{ Crazyhouse, Variant }

import lila.app.templating.Environment.{ *, given }
import lila.common.Json.given
import lila.game.GameExt.playerBlurPercent

lazy val ui     = lila.round.ui.RoundUi(helpers)
lazy val jsI18n = lila.round.ui.RoundI18n(helpers)

object bits:

  def crosstable(cross: Option[lila.game.Crosstable.WithMatchup], game: Game)(using ctx: Context) =
    cross.map: c =>
      views.game.ui.crosstable(ctx.userId.fold(c)(c.fromPov), game.id.some)

  def underchat(game: Game)(using ctx: Context) =
    frag(
      views.chat.spectatorsFrag,
      isGranted(_.ViewBlurs).option(
        div(cls := "round__mod")(
          game.players.all
            .filter(p => game.playerBlurPercent(p.color) > 30)
            .map { p =>
              div(
                playerLink(
                  p,
                  cssClass = s"is color-icon ${p.color.name}".some,
                  withOnline = false,
                  mod = true
                ),
                s" ${p.blurs.nb}/${game.playerMoves(p.color)} blurs ",
                strong(game.playerBlurPercent(p.color), "%")
              )
            }
            // game.players flatMap { p => p.holdAlert.map(p ->) } map {
            //   case (p, h) => div(
            //     playerLink(p, cssClass = s"is color-icon ${p.color.name}".some, mod = true, withOnline = false),
            //     "hold alert",
            //     br,
            //     s"(ply: ${h.ply}, mean: ${h.mean} ms, SD: ${h.sd})"
            //   )
            // }
        )
      )
    )

  def others(playing: List[Pov], simul: Option[lila.simul.Simul])(using Context) =
    frag(
      h3(
        simul.fold(trans.site.currentGames()): s =>
          span(cls := "simul")(
            a(href := routes.Simul.show(s.id))("SIMUL"),
            span(cls := "win")(s.wins, " W"),
            " / ",
            span(cls := "draw")(s.draws, " D"),
            " / ",
            span(cls := "loss")(s.losses, " L"),
            " / ",
            s.ongoing,
            " ongoing"
          ),
        "round-toggle-autoswitch".pipe: id =>
          span(
            cls      := "move-on switcher",
            st.title := trans.site.automaticallyProceedToNextGameAfterMoving.txt()
          )(
            label(`for` := id)(trans.site.autoSwitch()),
            span(cls := "switch")(form3.cmnToggle(id, id, checked = false))
          )
      ),
      div(cls := "now-playing"):
        val (myTurn, otherTurn) = playing.partition(_.isMyTurn)
        (myTurn ++ otherTurn.take(6 - myTurn.size))
          .take(9)
          .map: pov =>
            a(href := routes.Round.player(pov.fullId), cls := pov.isMyTurn.option("my_turn"))(
              span(
                cls := s"mini-game mini-game--init ${pov.game.variant.key} is2d",
                views.game.mini.renderState(pov)
              )(views.game.mini.cgWrap),
              span(cls := "meta")(
                playerUsername(
                  pov.opponent.light,
                  pov.opponent.userId.flatMap(lightUserSync),
                  withRating = false,
                  withTitle = true
                ),
                span(cls := "indicator")(
                  if pov.isMyTurn then
                    pov.remainingSeconds
                      .fold[Frag](trans.site.yourTurn())(secondsFromNow(_, alwaysRelative = true))
                  else nbsp
                )
              )
            )
    )

  private[round] def side(
      pov: Pov,
      data: play.api.libs.json.JsObject,
      tour: Option[lila.tournament.TourAndTeamVs],
      simul: Option[lila.simul.Simul],
      userTv: Option[User] = None,
      bookmarked: Boolean
  )(using Context) =
    views.game.side(
      pov,
      (data \ "game" \ "initialFen").asOpt[chess.format.Fen.Full],
      tour,
      simul = simul,
      userTv = userTv,
      bookmarked = bookmarked
    )

  private[round] def povChessground(pov: Pov)(using ctx: Context): Frag =
    chessground(
      board = pov.game.board,
      orient = pov.color,
      lastMove = pov.game.history.lastMove
        .map(_.origDest)
        .so: (orig, dest) =>
          List(orig, dest),
      blindfold = pov.player.blindfold,
      pref = ctx.pref
    )

  def roundAppPreload(pov: Pov)(using Context) =
    div(cls := "round__app")(
      div(cls := "round__app__board main-board")(povChessground(pov)),
      div(cls := "col1-rmoves-preload")
    )
