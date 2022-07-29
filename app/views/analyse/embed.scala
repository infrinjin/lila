package views.html.analyse

import controllers.routes
import play.api.libs.json.{ JsObject, Json }

import lila.app.templating.Environment._
import lila.app.ui.EmbedConfig
import lila.app.ui.ScalatagsTemplate._
import lila.common.String.html.safeJsonValue
import lila.i18n.MessageKey

object embed {

  import EmbedConfig.implicits._

  def apply(pov: lila.game.Pov, data: JsObject)(implicit config: EmbedConfig) =
    views.html.base.embed(
      title = views.html.analyse.replay titleOf pov,
      cssModule = "analyse.embed"
    )(
      div(cls    := "is2d")(
        main(cls := "analyse")
      ),
      footer {
        val url = routes.Round.watcher(pov.gameId, pov.color.name)
        frag(
          div(cls := "left")(
            a(targetBlank, href := url)(h1(titleGame(pov.game))),
            " ",
            em("brought to you by ", a(targetBlank, href := netBaseUrl)(netConfig.domain))
          ),
          a(targetBlank, cls := "open", href := url)("Open")
        )
      },
      views.html.base.layout.inlineJs(config.nonce)(config.lang),
      depsTag,
      jsModule("analysisBoard.embed"),
      analyseTag,
      embedJsUnsafeLoadThen(
        s"""analyseEmbed.embed(${safeJsonValue(
            Json.obj(
              "data"  -> data,
              "embed" -> true,
              "i18n"  -> views.html.board.userAnalysisI18n(withCeval = false, withExplorer = false)
            )
          )})""",
        config.nonce
      )
    )

  def lpv(pgn: String)(implicit config: EmbedConfig) =
    views.html.base.embed(
      title = "Lichess PGN viewer",
      cssModule = "lpv.embed"
    )(
      div(cls := "is2d")(div(pgn)),
      jsModule("lpv.embed"),
      embedJsUnsafe(
        s"""document.addEventListener("DOMContentLoaded",function(){LpvEmbed(document.body.firstChild.firstChild,${safeJsonValue(
            Json.obj("i18n" -> i18nJsObject(lpvI18n))
          )})})""",
        config.nonce
      )
    )

  val lpvI18n: Vector[MessageKey] = Vector(
    trans.flipBoard,
    trans.analysis,
    trans.practiceWithComputer,
    trans.download
  ).map(_.key)

  def notFound(implicit config: EmbedConfig) =
    views.html.base.embed(
      title = "404 - Game not found",
      cssModule = "analyse.embed"
    )(
      div(cls := "not-found")(
        h1("Game not found")
      )
    )
}
