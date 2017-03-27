'use strict'

const includes = require('lodash/includes')
const pull = require('pull-stream')
const Circuit = require('./circuit-relay')
const multicodec = require('./multicodec')
const EE = require('events').EventEmitter
const lp = require('pull-length-prefixed')
const multiaddr = require('multiaddr')
const handshake = require('pull-handshake')
const Connection = require('interface-connection').Connection

const debug = require('debug')

const log = debug('libp2p:circuit:listener')
log.err = debug('libp2p:circuit:error:listener')

module.exports = (swarm, handler, options) => {
  const listener = new EE()
  const relayCircuit = new Circuit(swarm)

  listener.listen = (ma, cb) => {
    cb = cb || (() => {})

    swarm.handle(multicodec, (proto, conn) => {
      conn.getPeerInfo((err, peerInfo) => {
        if (err) {
          log.err('Failed to identify incoming conn', err)
          return cb(err, null)
        }

        let stream = handshake({timeout: 1000 * 60})
        let shake = stream.handshake

        pull(
          stream,
          conn,
          stream
        )

        lp.decodeFromReader(shake, (err, msg) => {
          if (err) {
            log.err(err)
            return
          }

          let addr = multiaddr(msg.toString()) // read the src multiaddr
          // make a circuit
          if (includes(addr.protoNames(), 'p2p-circuit')) {
            relayCircuit.circuit(shake.rest(), addr, (err) => {
              if (err) {
                log.err(err)
                listener.emit('error', err)
                return handler(err)
              }

              listener.emit('circuit')
              return handler()
            })
          } else {
            // we need this to signal the circuit that the connection is ready
            // otherwise, the circuit will happen prematurely, which causes the
            // dialer to fail since the connection is not ready
            shake.write('\n')
            let newConn = new Connection(shake.rest(), conn)
            listener.emit('connection', newConn)
            handler(null, newConn)
          }
        })
      })
    })

    listener.emit('listen')
    cb()
  }

  listener.close = (cb) => {
    // TODO: should we close/abort the connection here?
    // spdy-transport throws a `Error: socket hang up`
    // on swarm stop right now, I think it's because
    // the socket is abruptly closed?
    swarm.unhandle(multicodec)
    listener.emit('close')
    cb()
  }

  listener.getAddrs = (callback) => {
    let addrs = swarm._peerInfo.distinctMultiaddr().filter((addr) => {
      return includes(addr.protoNames(), 'p2p-circuit')
    })

    const listenAddrs = []
    addrs.forEach((addr) => {
      const peerMa = `/p2p-circuit/ipfs/${swarm._peerInfo.id.toB58String()}`
      if (addr.toString() !== peerMa) {
        listenAddrs.push(addr.encapsulate(peerMa))
      } else {
        listenAddrs.push(peerMa)
      }
    })

    callback(null, listenAddrs)
  }

  return listener
}
