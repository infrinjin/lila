package views.html
package account

import controllers.routes
import play.api.i18n.Lang

import lila.app.templating.Environment.{ *, given }
import lila.app.ui.ScalatagsTemplate.{ *, given }

object security:

  def apply(
      u: lila.user.User,
      sessions: List[lila.security.LocatedSession],
      curSessionId: String,
      clients: List[lila.oauth.AccessTokenApi.Client],
      personalAccessTokens: Int
  )(using PageContext) =
    account.layout(title = s"${u.username} - ${trans.site.security.txt()}", active = "security"):
      div(cls := "security")(
        div(cls := "box")(
          h1(cls := "box__top")(trans.site.security()),
          standardFlash.map(div(cls := "box__pad")(_)),
          div(cls := "box__pad")(
            p(
              "This is a list of devices and applications that are logged into your account. If you notice any suspicious activity, make sure to ",
              a(href := routes.Account.email)("check your recovery email address"),
              " and ",
              a(href := routes.Account.passwd)("change your password"),
              "."
            ),
            (sessions.sizeIs > 1).option(
              div(
                "You can also ",
                postForm(cls := "revoke-all", action := routes.Account.signout("all"))(
                  submitButton(cls := "button button-empty button-red confirm")(
                    trans.site.revokeAllSessions()
                  )
                ),
                "."
              )
            )
          ),
          table(sessions, curSessionId.some, clients, personalAccessTokens)
        )
      )

  def table(
      sessions: List[lila.security.LocatedSession],
      curSessionId: Option[String],
      clients: List[lila.oauth.AccessTokenApi.Client],
      personalAccessTokens: Int
  )(using Translate) =
    st.table(cls := "slist slist-pad")(
      sessions.map { s =>
        tr(
          td(cls := "icon")(
            span(
              cls := curSessionId.map { cur => s"is-${if cur == s.session.id then "gold" else "green"}" },
              dataIcon := (if s.session.isMobile then licon.PhoneMobile else licon.ScreenDesktop)
            )
          ),
          td(cls := "info")(
            span(cls := "ip")(s.session.ip.value),
            " ",
            span(cls := "location")(s.location.map(_.toString)),
            p(cls := "ua")(s.session.ua),
            s.session.date.map { date =>
              p(cls := "date")(
                momentFromNow(date),
                curSessionId.has(s.session.id).option(span(cls := "current")("[CURRENT]"))
              )
            }
          ),
          curSessionId.map { cur =>
            td(
              (s.session.id != cur).option(
                postForm(action := routes.Account.signout(s.session.id))(
                  submitButton(
                    cls      := "button button-red",
                    title    := trans.site.logOut.txt(),
                    dataIcon := licon.X
                  )
                )
              )
            )
          }
        )
      },
      clients.map { client =>
        tr(
          td(cls := "icon")(span(cls := "is-green", dataIcon := licon.ThreeCheckStack)),
          td(cls := "info")(
            strong(client.origin),
            p(cls := "ua")(
              if client.scopes.nonEmpty then
                frag(
                  "Third party application with permissions: ",
                  client.scopes.map(_.name.txt()).mkString(", ")
                )
              else frag("Third party application using only public data.")
            ),
            client.usedAt.map { usedAt =>
              p(cls := "date")(
                "Last used ",
                momentFromNow(usedAt)
              )
            }
          ),
          td(
            postForm(action := routes.OAuth.revokeClient)(
              input(tpe        := "hidden", name             := "origin", value    := client.origin),
              submitButton(cls := "button button-red", title := "Revoke", dataIcon := licon.X)
            )
          )
        )
      },
      (personalAccessTokens > 0).option(
        tr(
          td(cls := "icon")(span(cls := "is-green", dataIcon := licon.Tools)),
          td(cls := "info")(
            strong("Personal access tokens"),
            " can be used to access your account. Revoke any that you do not recognize."
          ),
          td(
            a(
              href     := routes.OAuthToken.index,
              cls      := "button",
              title    := trans.oauthScope.apiAccessTokens.txt(),
              dataIcon := licon.Gear
            )
          )
        )
      )
    )
