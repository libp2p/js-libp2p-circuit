'use strict'

const includes = require('lodash.includes')
const Circuit = require('./circuit')
const multicodec = require('./multicodec')
const EE = require('events').EventEmitter

module.exports = (swarm, handler) => {
  const listener = new EE()
  const circuit = new Circuit(swarm)

  listener.listen = (ma, cb) => {
    cb = cb || (() => {})

    swarm.handle(multicodec, (proto, conn) => {
      circuit.handler(conn, (err, relayed) => {
        if (err) {
          listener.emit('error', err)
          return handler(err)
        }

        if (relayed) {
          listener.emit('connection')
        }

        handler(null, relayed)
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
