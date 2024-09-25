package lila.ask

import scala.concurrent.duration.*
import scala.collection.concurrent.TrieMap
import reactivemongo.api.bson.*

import lila.db.dsl.{ *, given }
import lila.core.id.AskId
import lila.core.ask.*
import lila.core.timeline.{ AskConcluded, Propagate }

final class AskRepo(
    askDb: lila.db.AsyncColl,
    // timeline: lila.timeline.Timeline,
    cacheApi: lila.memo.CacheApi
)(using
    Executor
) extends lila.core.ask.AskRepo:
  import lila.core.ask.Ask.*
  import AskApi.*

  given BSONDocumentHandler[Ask] = Macros.handler[Ask]

  private val cache = cacheApi.sync[AskId, Option[Ask]](
    name = "ask",
    initialCapacity = 1000,
    compute = getDb,
    default = _ => none[Ask],
    strategy = lila.memo.Syncache.Strategy.WaitAfterUptime(20 millis),
    expireAfter = lila.memo.Syncache.ExpireAfter.Access(1 hour)
  )

  def get(aid: AskId): Option[Ask] = cache.sync(aid)

  def getAsync(aid: AskId): Fu[Option[Ask]] = cache.async(aid)

  def preload(text: String*): Fu[Boolean] =
    val ids = text.flatMap(AskApi.extractIds)
    ids.map(getAsync).parallel.inject(ids.nonEmpty)

  // vid (voter id) are sometimes anonymous hashes.
  def setPicks(aid: AskId, vid: String, picks: Option[Vector[Int]]): Fu[Option[Ask]] =
    update(aid, vid, picks, modifyPicksCached, writePicks)

  def setForm(aid: AskId, vid: String, form: Option[String]): Fu[Option[Ask]] =
    update(aid, vid, form, modifyFormCached, writeForm)

  def unset(aid: AskId, vid: String): Fu[Option[Ask]] =
    update(aid, vid, none[Unit], unsetCached, writeUnset)

  def delete(aid: AskId): Funit = askDb: coll =>
    cache.invalidate(aid)
    coll.delete.one($id(aid)).void

  def conclude(aid: AskId): Fu[Option[Ask]] = askDb: coll =>
    coll
      .findAndUpdateSimplified[Ask]($id(aid), $addToSet("tags" -> "concluded"), fetchNewObject = true)
      .collect:
        case Some(ask) =>
          cache.set(aid, ask.some) // TODO fix timeline
          /*if ask.url.nonEmpty && !ask.isAnon then
            timeline ! Propagate(AskConcluded(ask.creator, ask.question, ~ask.url))
              .toUsers(ask.participants.map(UserId(_)).toList)
              .exceptUser(ask.creator)*/
          ask.some

  def reset(aid: AskId): Fu[Option[Ask]] = askDb: coll =>
    coll
      .findAndUpdateSimplified[Ask](
        $id(aid),
        $doc($unset("picks", "form"), $pull("tags" -> "concluded")),
        fetchNewObject = true
      )
      .collect:
        case Some(ask) =>
          cache.set(aid, ask.some)
          ask.some

  def byUser(uid: UserId): Fu[List[Ask]] = askDb: coll =>
    coll
      .find($doc("creator" -> uid))
      .sort($sort.desc("createdAt"))
      .cursor[Ask]()
      .list(50)
      .map: asks =>
        asks.map(a => cache.set(a._id, a.some))
        asks

  def deleteAll(text: String): Funit = askDb: coll =>
    val ids = AskApi.extractIds(text)
    ids.map(cache.invalidate)
    if ids.nonEmpty then coll.delete.one($inIds(ids)).void
    else funit

  // none values (deleted asks) in these lists are still important for sequencing in renders
  def asksIn(text: String): Fu[List[Option[Ask]]] = askDb: coll =>
    val ids = AskApi.extractIds(text)
    ids.map(getAsync).parallel.inject(ids.map(get))

  def isOpen(aid: AskId): Fu[Boolean] = askDb: coll =>
    getAsync(aid).map(_.exists(_.isOpen))

  // call this after freezeAsync on form submission for edits
  def setUrl(text: String, url: Option[String]): Funit = askDb: coll =>
    if !hasAskId(text) then funit
    else
      val selector = $inIds(AskApi.extractIds(text))
      coll.update.one(selector, $set("url" -> url), multi = true) >>
        coll.list(selector).map(_.foreach(ask => cache.set(ask._id, ask.copy(url = url).some)))

  private val emptyPicks = Map.empty[String, Vector[Int]]
  private val emptyForm  = Map.empty[String, String]

  private def getDb(aid: AskId) = askDb: coll =>
    coll.byId[Ask](aid)

  private def update[A](
      aid: AskId,
      vid: String,
      value: Option[A],
      cached: (Ask, String, Option[A]) => Ask,
      writeField: (AskId, String, Option[A], Boolean) => Fu[Option[Ask]]
  ) =
    cache.sync(aid) match
      case Some(ask) =>
        val cachedAsk = cached(ask, vid, value)
        cache.set(aid, cachedAsk.some)
        writeField(aid, vid, value, false).inject(cachedAsk.some)
      case _ =>
        writeField(aid, vid, value, true).collect:
          case Some(ask) =>
            cache.set(aid, ask.some)
            ask.some

  // hey i know, let's write 17 functions so we can reuse 2 lines of code
  private def modifyPicksCached(ask: Ask, vid: String, newPicks: Option[Vector[Int]]) =
    ask.copy(picks = newPicks.fold(ask.picks.fold(emptyPicks)(_ - vid).some): p =>
      ((ask.picks.getOrElse(emptyPicks) + (vid -> p)).some))

  private def modifyFormCached(ask: Ask, vid: String, newForm: Option[String]) =
    ask.copy(form = newForm.fold(ask.form.fold(emptyForm)(_ - vid).some): f =>
      ((ask.form.getOrElse(emptyForm) + (vid -> f)).some))

  private def unsetCached(ask: Ask, vid: String, unused: Option[Unit]) =
    ask.copy(picks = ask.picks.fold(emptyPicks)(_ - vid).some, form = ask.form.fold(emptyForm)(_ - vid).some)

  private def writePicks(aid: AskId, vid: String, picks: Option[Vector[Int]], fetchNew: Boolean) =
    updateAsk(aid, picks.fold($unset(s"picks.$vid"))(r => $set(s"picks.$vid" -> r)), fetchNew)

  private def writeForm(aid: AskId, vid: String, form: Option[String], fetchNew: Boolean) =
    updateAsk(aid, form.fold($unset(s"form.$vid"))(f => $set(s"form.$vid" -> f)), fetchNew)

  private def writeUnset(aid: AskId, vid: String, unused: Option[Unit], fetchNew: Boolean) =
    updateAsk(aid, $unset(s"picks.$vid", s"form.$vid"), fetchNew)

  private def updateAsk(aid: AskId, update: BSONDocument, fetchNew: Boolean) = askDb: coll =>
    coll.update
      .one($and($id(aid), $doc("tags" -> $ne("concluded"))), update)
      .flatMap:
        case _ => if fetchNew then getAsync(aid) else fuccess(none[Ask])

  // only preserve votes if important fields haven't been altered
  private[ask] def upsert(ask: Ask): Fu[Ask] = askDb: coll =>
    coll
      .byId[Ask](ask._id)
      .flatMap:
        case Some(dbAsk) =>
          val mergedAsk = ask.merge(dbAsk)
          cache.set(ask._id, mergedAsk.some)
          if dbAsk eq mergedAsk then fuccess(mergedAsk)
          else coll.update.one($id(ask._id), mergedAsk).inject(mergedAsk)
        case _ =>
          cache.set(ask._id, ask.some)
          coll.insert.one(ask).inject(ask)
