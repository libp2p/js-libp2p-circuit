'use strict'

const config = require('../config')
const pull = require('pull-stream')
const multiaddr = require('multiaddr')
const PeerInfo = require('peer-info')
const Peer = require('../peer')
const includes = require('lodash/includes')
const lp = require('pull-length-prefixed')
const handshake = require('pull-handshake')
const Connection = require('interface-connection').Connection

const multicodec = config.multicodec

const log = config.log

class Listener {
    constructor(libp2p, handler) {
        this.libp2p = libp2p
        this.peers = new Map()
        this.handler = handler

        this._onConnection = this._onConnection.bind(this)
    }

    listen(cb) {
        cb = cb || function() {}
        this.libp2p.handle(multicodec, this._onConnection)
        cb()
    }

    close(cb) {
        cb = cb || function() {}
        this.libp2p.unhandle(multicodec)
        cb()
    }

    _onConnection(protocol, conn) {
        conn.getPeerInfo((err, peerInfo) => {
            if (err) {
                log.err('Failed to identify incomming conn', err)
                return pull(pull.empty(), conn)
            }

            const idB58Str = peerInfo.id.toB58String()
            let relayPeer = this.peers.get(idB58Str)
            if (!relayPeer) {
                log('new relay peer', idB58Str)
                relayPeer = peerInfo
                this.peers.set(idB58Str, new Peer(conn, peerInfo))
            }
            this._processConnection(relayPeer, conn)
        })
    }

    _processConnection(relayPeer, conn) {
        let stream = handshake({ timeout: 1000 * 60 })
        let shake = stream.handshake

        lp.decodeFromReader(shake, (err, msg) => {
            if (err) {
                err(err)
                return err
            }

            let addr = multiaddr(msg.toString())
            let src
            try {
                PeerInfo.create(addr.peerId(), (err, peerInfo) => {
                    if (err) {
                        log.err(err)
                        return err
                    }

                    if (includes(addr.protoNames(), 'ipfs')) {
                        addr = addr.decapsulate('ipfs')
                    }

                    peerInfo.multiaddr.add(addr)
                    src = peerInfo
                    this.handler(new Connection(shake.rest(), peerInfo))
                })
            } catch (err) {
                log.err(err)
            }
        })

        pull(stream, conn, stream)
    }

}

module.exports = Listener