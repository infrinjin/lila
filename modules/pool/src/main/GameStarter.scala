package lila.pool

import chess.ByColor

import lila.game.{ Game, GameRepo, IdGenerator, Player }

import lila.user.{ UserPerfsRepo, UserRepo }
import lila.core.pool.{ Pairing, Pairings }

final private class GameStarter(
    userRepo: UserRepo,
    perfsRepo: UserPerfsRepo,
    gameRepo: GameRepo,
    idGenerator: IdGenerator,
    onStart: GameId => Unit
)(using Executor, Scheduler):

  private val workQueue = scalalib.actor.AsyncActorSequencer(
    maxSize = Max(32),
    timeout = 10 seconds,
    name = "gameStarter",
    lila.log.asyncActorMonitor
  )

  def apply(pool: PoolConfig, couples: Vector[MatchMaking.Couple]): Funit =
    couples.nonEmpty.so:
      workQueue:
        val userIds = couples.flatMap(_.userIds)
        for
          (perfs, ids) <- perfsRepo.perfOf(userIds, pool.perfType).zip(idGenerator.games(couples.size))
          pairings     <- couples.zip(ids).map((one(pool, perfs)).tupled).parallel
        yield lila.common.Bus.publish(Pairings(pairings.flatten.toList), "poolPairings")

  private def one(pool: PoolConfig, perfs: Map[UserId, Perf])(
      couple: MatchMaking.Couple,
      id: GameId
  ): Fu[Option[Pairing]] =
    import couple.*
    (perfs.get(p1.userId), perfs.get(p2.userId)).tupled
      .soFu: (perf1, perf2) =>
        for
          p1White <- userRepo.firstGetsWhite(p1.userId, p2.userId)
          (whitePerf, blackPerf)     = if p1White then perf1 -> perf2 else perf2 -> perf1
          (whiteMember, blackMember) = if p1White then p1 -> p2 else p2 -> p1
          game = makeGame(
            id,
            pool,
            whiteMember.userId -> whitePerf,
            blackMember.userId -> blackPerf
          ).start
          _ <- gameRepo.insertDenormalized(game)
        yield
          onStart(game.id)
          Pairing(ByColor(whiteMember.sri -> game.fullIds.white, blackMember.sri -> game.fullIds.black))

  private def makeGame(
      id: GameId,
      pool: PoolConfig,
      whiteUser: (UserId, Perf),
      blackUser: (UserId, Perf)
  ) =
    Game(
      id = id,
      chess = chess.Game(
        situation = chess.Situation(chess.variant.Standard),
        clock = pool.clock.toClock.some
      ),
      players = ByColor(whiteUser, blackUser).mapWithColor(Player.make),
      mode = chess.Mode.Rated,
      status = chess.Status.Created,
      daysPerTurn = none,
      metadata = Game.metadata(lila.core.game.Source.Pool)
    )
