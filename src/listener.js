'use strict'

const includes = require('lodash/includes')
const pull = require('pull-stream')
const Circuit = require('./circuit')
const multicodec = require('./multicodec')
const EE = require('events').EventEmitter
const lp = require('pull-length-prefixed')
const multiaddr = require('multiaddr')
const handshake = require('pull-handshake')
const Connection = require('interface-connection').Connection

const debug = require('debug')

const log = debug('libp2p:circuit:listener')
log.err = debug('libp2p:circuit:error:listener')

module.exports = (swarm, handler) => {
  const listener = new EE()
  const circuit = new Circuit(swarm)

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

        lp.decodeFromReader(shake, (err, msg) => {
          if (err) {
            log.err(err)
            return
          }

          let addr = multiaddr(msg.toString())
          // make a circuit
          if (includes(addr.protoNames(), 'p2p-circuit')) {
            circuit.handler(shake.rest(), addr, (err) => {
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
            // otherwise, it seems be get circuited prematurely, which causes the
            // dialer to fail on a non ready connection
            shake.write('\n')
            let newConn = new Connection(shake.rest(), conn)
            listener.emit('connection', newConn)
            handler(null, newConn)
          }
        })

        pull(stream, conn, stream)
      })
    })

    listener.emit('listen')
    cb()
  }

  listener.close = () => {
    swarm.unhandle(multicodec)
    listener.emit('close')
  }

  listener.getAddrs = (callback) => {
    let addrs = swarm._peerInfo.distinctMultiaddr().filter((addr) => {
      return includes(addr.protoNames(), 'p2p-circuit')
    })

    callback(null, addrs)
  }

  return listener
}
