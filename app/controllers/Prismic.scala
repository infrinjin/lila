package controllers

import io.prismic.{ Api as PrismicApi, * }
import lila.app.{ given, * }
import play.api.mvc.RequestHeader
import lila.app.http.RequestGetter
import lila.cms.CmsPage
import lila.security.Granter

object Prismic:
  type AnyPage = Either[CmsPage.Render, (Document, DocumentLinkResolver)]
  extension (p: AnyPage)
    def pageId = p.fold(_.id.some, _ => none)
    def title  = p.fold(_.title, ~_._1.getText("doc.title"))
    def slugs  = p.fold(_.id.value :: Nil, _._1.slugs)
    def html: Html = p.fold(
      _.html,
      (doc, res) =>
        lila.blog.BlogTransform.markdown:
          Html(~doc.getHtml("doc.content", res))
    )

final class Prismic(env: Env)(using Executor, play.api.libs.ws.StandaloneWSClient) extends RequestGetter:

  private val logger = lila.log("prismic")

  import env.blog.api.prismicApi

  type MakeLinkResolver = PrismicApi => DocumentLinkResolver
  given makeLinkResolver: MakeLinkResolver = prismicApi =>
    DocumentLinkResolver(prismicApi): (link, _) =>
      routes.Blog.show(link.id, link.slug).url

  private def getDocument(id: String): Fu[Option[Document]] =
    lila.blog.BlogApi.looksLikePrismicId(id) so
      prismicApi.flatMap: api =>
        api
          .forms("everything")
          .query(s"""[[:d = at(document.id, "$id")]]""")
          .ref(api.master.ref)
          .submit() dmap {
          _.results.headOption
        }

  def getBookmark(name: String)(using ctx: Context): Fu[Option[Prismic.AnyPage]] =
    (!getBool("prismic")(using ctx.req))
      .so:
        env.cms.api
          .render(lila.cms.CmsPage.Id(name))
          .map:
            _.filter(_.live || ctx.me.soUse(Granter(_.Pages))).map(Left.apply)
      .orElse:
        prismicApi
          .flatMap: api =>
            api.bookmarks.get(name) so getDocument map2 { doc =>
              Right(doc -> makeLinkResolver(api))
            }
          .recover { case e: Exception =>
            logger.error(s"bookmark:$name", e)
            none
          }

  def getVariant(variant: chess.variant.Variant): Fu[Option[Prismic.AnyPage]] =
    env.cms.api
      .render(lila.cms.CmsPage.Id(s"variant-${variant.key}"))
      .map2(Left.apply)
      .orElse:
        prismicApi.flatMap: api =>
          api
            .forms("variant")
            .query(s"""[[:d = at(my.variant.key, "${variant.key}")]]""")
            .ref(api.master.ref)
            .submit()
            .map:
              _.results.headOption.map: doc =>
                Right(doc -> makeLinkResolver(api))
