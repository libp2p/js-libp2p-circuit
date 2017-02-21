'use strict'

require('safe-buffer')
require('setimmediate')

const multicodec = require('./multicodec')
const EE = require('events').EventEmitter
const multiaddr = require('multiaddr')
const Connection = require('interface-connection').Connection
const mafmt = require('mafmt')
const constants = require('./circuit/constants')
const waterfall = require('async/waterfall')
const StreamHandler = require('./circuit/stream-handler')

const debug = require('debug')

const log = debug('libp2p:circuit:listener')
log.err = debug('libp2p:circuit:error:listener')

module.exports = (swarm, options, handler) => {
  const listener = new EE()

  listener.listen = (ma, callback) => {
    callback = callback || (() => {})

    swarm.handle(multicodec.stop, (proto, conn) => {
      conn.getPeerInfo((err, peerInfo) => {
        if (err) {
          log.err('Failed to identify incoming connection', err)
          return handler(err, null)
        }

        const streamHandler = new StreamHandler(conn)
        waterfall([
          (cb) => {
            streamHandler.read((err, msg) => {
              if (err) {
                log.err(err)

                if (err.includes('size longer than max permitted length of')) {
                  const errCode = String(constants.RESPONSE.STOP.SRC_ADDR_TOO_LONG)
                  setImmediate(() => this.emit('circuit:error', errCode))
                  streamHandler.write([Buffer.from(errCode)])
                }

                return cb(err)
              }

              let srcMa = null
              try {
                srcMa = multiaddr(msg.toString())
              } catch (err) {
                const errCode = String(constants.RESPONSE.STOP.SRC_MULTIADDR_INVALID)
                setImmediate(() => this.emit('circuit:error', errCode))
                streamHandler.write([Buffer.from(errCode)])
                return cb(errCode)
              }

              // add the addr we got along with the relay request
              peerInfo.multiaddrs.add(srcMa)
              cb()
            })
          },
          (cb) => {
            streamHandler.write([Buffer.from(String(constants.RESPONSE.SUCCESS))], (err) => {
              if (err) {
                log.err(err)
                return cb(err)
              }

              const newConn = new Connection(streamHandler.rest(), conn)
              newConn.setPeerInfo(peerInfo)
              setImmediate(() => listener.emit('connection', newConn))
              handler(newConn)
              cb()
            })
          }
        ])
      })
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
