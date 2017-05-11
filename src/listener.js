'use strict'

const setImmediate = require('async/setImmediate')

const multicodec = require('./multicodec')
const EE = require('events').EventEmitter
const multiaddr = require('multiaddr')
const mafmt = require('mafmt')
const Stop = require('./circuit/stop')

const debug = require('debug')

const log = debug('libp2p:circuit:listener')
log.err = debug('libp2p:circuit:error:listener')

module.exports = (swarm, options, handler) => {
  const listener = new EE()
  const stopHandler = new Stop(swarm)

  listener.listen = (ma, callback) => {
    callback = callback || (() => {})

    swarm.handle(multicodec.stop, (proto, conn) => {
      stopHandler.handle(conn, handler)
    })

    setImmediate(() => listener.emit('listen'))
    callback()
  }

  listener.close = (cb) => {
    swarm.unhandle(multicodec.stop)
    setImmediate(() => listener.emit('close'))
    cb()
  }

  listener.getAddrs = (callback) => {
    let addrs = swarm._peerInfo.multiaddrs.toArray()

    // get all the explicit relay addrs excluding self
    let p2pAddrs = addrs.filter((addr) => {
      return mafmt.Circuit.matches(addr) &&
        !addr.toString().includes(swarm._peerInfo.id.toB58String())
    })

    // use the explicit relays instead of any relay
    if (p2pAddrs.length) {
      addrs = p2pAddrs
    }

    let listenAddrs = []
    addrs.forEach((addr) => {
      const peerMa = `/p2p-circuit/ipfs/${swarm._peerInfo.id.toB58String()}`
      if (addr.toString() === peerMa) {
        listenAddrs.push(multiaddr(peerMa))
        return
      }

      if (!mafmt.Circuit.matches(addr)) {
        // by default we're reachable over any relay
        listenAddrs.push(multiaddr(`/p2p-circuit`).encapsulate(`${addr}/ipfs/${swarm._peerInfo.id.toB58String()}`))
      } else {
        listenAddrs.push(addr.encapsulate(`/ipfs/${swarm._peerInfo.id.toB58String()}`))
      }
    })

    callback(null, listenAddrs)
  }

  return listener
}
