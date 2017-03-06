'use strict'

/**
 * The known state of a connected peer.
 */
class Peer {
  /**
   * @param {Connection} conn
   * @param {PeerInfo} peerInfo
   */
  constructor (conn, peerInfo) {
    /**
     * @type {Connection}
     */
    this.conn = conn
    /**
     * @type {PeerInfo}
     */
    this.peerInfo = peerInfo
  }

  /**
   * Attach a connection
   * @param {Connection} conn
   * @returns {void}
   */
  attachConnection (conn) {
    this.conn = conn
  }

  /**
   * Is the peer connected currently?
   *
   * @type {boolean}
   */
  get isConnected () {
    return Boolean(this.conn)
  }
}

module.exports = Peer
