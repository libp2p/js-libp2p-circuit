'use strict'

const pull = require('pull-stream')
const lp = require('pull-length-prefixed')
const handshake = require('pull-handshake')

const debug = require('debug')
const log = debug('libp2p:circuit:stream-handler')
log.err = debug('libp2p:circuit:error:stream-handler')

class StreamHandler {
  /**
   * Create a stream handler for connection
   *
   * @param {Connection} conn - connection to read/write
   * @param {Number} [timeout] - handshake timeout
   * @param {Number} [maxLength] - max bytes length of message
   */
  constructor (conn, timeout, maxLength) {
    this.conn = conn
    this.stream = null
    this.shake = null
    this.maxLength = maxLength || 1024

    this.stream = handshake({timeout: timeout || 1000 * 60})
    this.shake = this.stream.handshake

    pull(this.stream, conn, this.stream)
  }

  isValid () {
    return this.conn && this.shake && this.stream
  }

  /**
   * Read and decode message
   *
   * @param {Function} cb
   * @returns {void|Function}
   */
  read (cb) {
    if (!this.isValid()) {
      cb(new Error(`handler is not in a valid state`))
    }

    lp.decodeFromReader(this.shake, {maxLength: this.maxLength}, (err, msg) => {
      if (err) {
        log.err(err)
        // this.shake.abort(err)
        return cb(err)
      }

      return cb(null, msg)
    })
  }

  /**
   * Encode and write array of buffers
   *
   * @param {Buffer[]} msg
   * @param {Function} [cb]
   * @returns {Function}
   */
  write (msg, cb) {
    cb = cb || (() => {})

    if (!this.isValid()) {
      cb(new Error(`handler is not in a valid state`))
    }

    pull(
      pull.values(msg),
      lp.encode(),
      pull.collect((err, encoded) => {
        if (err) {
          log.err(err)
          this.shake.abort(err)
        }

        encoded.forEach((e) => this.shake.write(e))
        cb()
      })
    )
  }

  /**
   * Return the handshake rest stream and invalidate handler
   *
   * @return {*|{source, sink}}
   */
  rest () {
    const rest = this.shake.rest()

    this.conn = null
    this.stream = null
    this.shake = null
    return rest
  }
}

module.exports = StreamHandler
