package lila.user

import play.api.libs.json.*

import lila.common.Json.{ writeAs, given }
import lila.core.LightUser
import lila.rating.{ Perf, PerfType }

import User.{ LightPerf, PlayTime }
import lila.core.rating.PerfKey

final class JsonView(isOnline: lila.core.socket.IsOnline):

  import JsonView.{ *, given }
  private given OWrites[Profile]  = Json.writes
  private given OWrites[PlayTime] = Json.writes

  def full(
      u: User,
      perfs: Option[UserPerfs | Perf.Typed],
      withProfile: Boolean
  ): JsObject =
    if u.enabled.no then disabled(u.light)
    else
      base(u, perfs) ++ Json
        .obj("createdAt" -> u.createdAt)
        .add(
          "profile" -> u.profile
            .ifTrue(withProfile)
            .map(p => Json.toJsObject(p.filterTroll(u.marks.troll)).noNull)
        )
        .add("seenAt" -> u.seenAt)
        .add("playTime" -> u.playTime)

  def roundPlayer(u: User, perf: Option[Perf.Typed]) =
    if u.enabled.no then disabled(u.light)
    else base(u, perf).add("online" -> isOnline(u.id))

  private def base(u: User, perfs: Option[UserPerfs | Perf.Typed]) =
    Json
      .obj(
        "id"       -> u.id,
        "username" -> u.username,
        "perfs" -> perfs.fold(Json.obj()):
          case p: UserPerfs  => perfsJson(p)
          case p: Perf.Typed => perfTypedJson(p)
      )
      .add("title" -> u.title)
      .add("flair" -> u.flair)
      .add("tosViolation" -> u.lame)
      .add("patron" -> u.isPatron)
      .add("verified" -> u.isVerified)

  def lightPerfIsOnline(lp: LightPerf) =
    lightPerfWrites.writes(lp).add("online" -> isOnline(lp.user.id))

  given lightPerfIsOnlineWrites: OWrites[User.LightPerf] = OWrites(lightPerfIsOnline)

  def disabled(u: LightUser) = Json.obj(
    "id"       -> u.id,
    "username" -> u.name,
    "disabled" -> true
  )
  def ghost = disabled(LightUser.ghost)

object JsonView:

  val nameWrites: Writes[User.WithPerfs] = writeAs(_.user.username)

  given lightPerfWrites: OWrites[LightPerf] = OWrites[LightPerf]: l =>
    Json
      .obj(
        "id"       -> l.user.id,
        "username" -> l.user.name,
        "perfs" -> Json.obj(
          l.perfKey.value -> Json.obj("rating" -> l.rating, "progress" -> l.progress)
        )
      )
      .add("title" -> l.user.title)
      .add("patron" -> l.user.isPatron)

  val modWrites = OWrites[User]: u =>
    Json.toJsObject(u.light) ++ Json
      .obj("games" -> u.count.game)
      .add("tos" -> u.marks.dirty)

  given perfWrites: OWrites[Perf] = OWrites: o =>
    Json
      .obj(
        "games"  -> o.nb,
        "rating" -> o.glicko.rating.toInt,
        "rd"     -> o.glicko.deviation.toInt,
        "prog"   -> o.progress
      )
      .add("prov", o.glicko.provisional)

  private val standardPerfKeys: Set[PerfKey] = PerfType.standard.map(_.key).toSet

  def perfTypedJson(p: Perf.Typed): JsObject =
    Json.obj(p.perfType.key.value -> p.perf)

  def perfsJson(p: UserPerfs): JsObject =
    JsObject:
      p.perfsMap.collect:
        case (key, perf) if perf.nb > 0 || standardPerfKeys(key) =>
          key.value -> perfWrites.writes(perf)
    .add("storm", p.storm.option.map(puzPerfJson))
      .add("racer", p.racer.option.map(puzPerfJson))
      .add("streak", p.streak.option.map(puzPerfJson))

  private def puzPerfJson(p: Perf.PuzPerf) = Json.obj(
    "runs"  -> p.runs,
    "score" -> p.score
  )

  def perfsJson(perfs: UserPerfs, onlyPerfs: List[PerfType]) =
    JsObject:
      onlyPerfs.map: perfType =>
        perfType.key.value -> perfWrites.writes(perfs(perfType))

  def notes(ns: List[Note])(using lightUser: LightUserApi) =
    lightUser
      .preloadMany(ns.flatMap(_.userIds).distinct)
      .inject(JsArray:
        ns.map: note =>
          Json
            .obj(
              "from" -> lightUser.syncFallback(note.from),
              "to"   -> lightUser.syncFallback(note.to),
              "text" -> note.text,
              "date" -> note.date
            )
            .add("mod", note.mod)
            .add("dox", note.dox)
      )

  given leaderboardsWrites(using OWrites[User.LightPerf]): OWrites[UserPerfs.Leaderboards] =
    OWrites: leaderboards =>
      Json.obj(
        "bullet"        -> leaderboards.bullet,
        "blitz"         -> leaderboards.blitz,
        "rapid"         -> leaderboards.rapid,
        "classical"     -> leaderboards.classical,
        "ultraBullet"   -> leaderboards.ultraBullet,
        "crazyhouse"    -> leaderboards.crazyhouse,
        "chess960"      -> leaderboards.chess960,
        "kingOfTheHill" -> leaderboards.kingOfTheHill,
        "threeCheck"    -> leaderboards.threeCheck,
        "antichess"     -> leaderboards.antichess,
        "atomic"        -> leaderboards.atomic,
        "horde"         -> leaderboards.horde,
        "racingKings"   -> leaderboards.racingKings
      )

  given leaderboardStandardTopOneWrites(using OWrites[User.LightPerf]): OWrites[UserPerfs.Leaderboards] =
    OWrites: leaderboards =>
      Json.obj(
        "bullet"      -> leaderboards.bullet.headOption,
        "blitz"       -> leaderboards.blitz.headOption,
        "rapid"       -> leaderboards.rapid.headOption,
        "classical"   -> leaderboards.classical.headOption,
        "ultraBullet" -> leaderboards.ultraBullet.headOption
      )
