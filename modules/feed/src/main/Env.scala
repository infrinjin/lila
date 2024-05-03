package lila.feed

import com.softwaremill.macwire.*

import lila.core.lilaism.Lilaism.*
import lila.core.config.CollName

@Module
final class Env(
    cacheApi: lila.memo.CacheApi,
    db: lila.db.Db,
    flairApi: lila.core.user.FlairApi,
    askEmbed: lila.core.ask.AskEmbed
)(using Executor):

  private val feedColl = db(CollName("daily_feed"))
  val api              = wire[FeedApi]
  val paginator        = wire[FeedPaginatorBuilder]

  export api.lastUpdate
