'use strict'

require('setimmediate')

const EE = require('events').EventEmitter
const Buffer = require('safe-buffer').Buffer
const waterfall = require('async/waterfall')
const StreamHandler = require('./stream-handler')
const constants = require('./constants')
const multiaddr = require('multiaddr')
const Connection = require('interface-connection').Connection

const debug = require('debug')

const log = debug('libp2p:circuit:stop')
log.err = debug('libp2p:circuit:error:stop')

class Stop extends EE {
  constructor (swarm) {
    super()
    this.swarm = swarm
  }

  handle (conn, callback) {
    callback = callback || (() => {})

    conn.getPeerInfo((err, peerInfo) => {
      if (err) {
        log.err('Failed to identify incoming connection', err)
        return callback(err, null)
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
            setImmediate(() => this.emit('connection', newConn))
            callback(newConn)
            cb()
          })
        }
      ])
    })
  }
}

module.exports = Stop
