import { Server, Socket } from 'socket.io'
import { createServer } from 'http'
import express from 'express'
import Match from './logic/Match'
import { ROUND_COUNT, ROUND_DURATION, SERVER_PORT } from './config'
import { Move, Result, Side } from './logic/gameLogic'
import { isMove } from './validateInput'
import { Matchup, RoundReason, RoundResult } from './types'
import { Round } from './logic/Round'

const app = express()
const server = createServer(app)
const io = new Server(server)

const connections: Socket[] = []

const bots: Matchup = {}

const match = new Match(ROUND_COUNT, ROUND_DURATION)

io.on('connection', (socket) => {
  connections.push(socket)

  socket.on('disconnect', () => {
    connections.splice(connections.indexOf(socket), 1)
    if (bots.left?.socket === socket) {
      bots.left = undefined
    }
    if (bots.right?.socket === socket) {
      bots.right = undefined
    }
  })

  socket.on('bot', (bot: string) => {
    if (!bots.left) {
      bots.left = { name: bot, socket }
    } else if (!bots.right) {
      bots.right = { name: bot, socket }
    } else {
      throw new Error('Too many bots')
    }
  })

  console.log('Connections: ', connections.length)
  console.log('Bots: ', bots)
})

server.listen(SERVER_PORT)
console.log("Server listening on port " + SERVER_PORT)

function socketToPromiseRepeater(socket: Socket): () => Promise<Move> {
  let resolvePromise: ((move: Move) => void) | null = null

  socket.on('move', (args) => {
    if (!isMove(args)) return // Ignore invalid moves
    resolvePromise?.(args)
    console.log('Move: ', args)
  })

  return () => {
    return new Promise((resolve) => {
      resolvePromise = resolve
    })
  }
}

async function startMatch() {
  const left = connections[0]
  const right = connections[1]
  const waitForLeftMove = socketToPromiseRepeater(left)
  const waitForRightMove = socketToPromiseRepeater(right)

  match.run(
    (leftResult) => {
      left.emit('round', leftResult)
      return waitForLeftMove()
    },
    (rightResult) => {
      right.emit('round', rightResult)
      return waitForRightMove()
    },
    (result) => {
      io.emit('rounds', {
        rounds: match.rounds.map(async ({ left, right, result }: Round) => {
          const { winner, reason } : { winner: Result, reason: RoundReason} = await result
          return {
            left,
            right,
            winner,
            reason,
          }
        }),
      })
    }
  )

  const result = await match.result
  console.log('Match result: ', result)
}
