'use strict'

const pull = require('pull-stream')
const handshake = require('pull-handshake')
const mss = require('multistream-select')
const config = require('./config')
const abortable = require('pull-abortable')
const utils = require('./utils')

const log = config.log

class RelaySession {
  /**
   * Constructs a relay RelaySession
   * @param {Peer} src - the source peer
   * @param {Peer} dst - the destination peer
   */
  constructor (src, dst) {
    this.src = src
    this.dst = dst
    this.srcStrAddr = null
    this.dstStrAddr = null
    this.circuitAddr = null
    this.stream = abortable()
    this.isActive = false
  }

  /**
   * is relay active
   * @returns {Boolean} is stream active
   */
  isActive () {
    return this.isActive
  }

  /**
   * Circuit two connections
   * @returns {void}
   */
  circuit () {
    let stream = handshake({timeout: 1000 * 60}, (err) => {
      log.err(err)
      this.stream.abort()
    })

    let shake = stream.handshake

    mss.util.writeEncoded(
      shake,
      utils.getDstAddrAsString(this.dst.peerInfo)
    )

    // create handshake stream
    pull(
      stream,
      this.dst.conn,
      stream
    )

    // circuit the src and dst streams
    pull(
      this.src.conn,
      shake.rest(),
      this.stream,
      this.src.conn
    )

    this.isActive = true
  }

  /**
   * Closes the open connection to peer
   *
   * @param {Function} callback
   * @returns {undefined}
   */
  close (callback) {
    // abort the circuit stream
    if (this.stream) {
      this.stream.abort()
    }
    setImmediate(() => {
      this.stream = null
      callback()
    })
  }
}

module.exports = RelaySession
