/* eslint-env mocha */
'use strict'

const Node = require('libp2p-ipfs-nodejs')
const BrowserNode = require('libp2p-ipfs-browser')
const PeerInfo = require('peer-info')
const series = require('async/series')
const pull = require('pull-stream')
const Libp2p = require('libp2p')
const multistream = require('multistream-select')
const Connection = require('interface-connection').Connection
const multiaddr = require('multiaddr')

const TCP = require('libp2p-tcp')
const WebRTCStar = require('libp2p-webrtc-star')
const MulticastDNS = require('libp2p-mdns')
const WS = require('libp2p-websockets')
const Railing = require('libp2p-railing')
const spdy = require('libp2p-spdy')
const multiplex = require('libp2p-multiplex')
const secio = require('libp2p-secio')

const expect = require('chai').expect

process.on('uncaughtException', function (err) {
  console.log(err)
})

class TestNode extends Libp2p {
  constructor (peerInfo, transports, options) {
    options = options || {}

    const modules = {
      transport: transports,
      connection: {
        muxer: [
          spdy
        // multiplex
        ],
        crypto: [
          // secio
        ]
      },
      discovery: []
    }
    super(modules, peerInfo, null, options)
  }
}

describe(`test circuit`, function () {
  let srcNode
  let dstNode
  let relayNode

  let srcPeer
  let dstPeer
  let relayPeer

  let portBase = 9000 // TODO: randomize or mock sockets
  before((done) => {
    series([
      (cb) => {
        PeerInfo.create((err, info) => {
          relayPeer = info
          relayPeer.multiaddr.add(`/ip4/0.0.0.0/tcp/${portBase++}`)
          relayPeer.multiaddr.add(`/ip4/0.0.0.0/tcp/${portBase++}/ws`)
          relayPeer.multiaddr.add(`/p2p-circuit`)
          relayNode = new TestNode(relayPeer, [new TCP(), new WS()], {relay: true})
          cb(err)
        })
      },
      (cb) => {
        PeerInfo.create((err, info) => {
          srcPeer = info
          srcPeer.multiaddr.add(`/ip4/0.0.0.0/tcp/${portBase++}/ws`)
          srcNode = new TestNode(srcPeer, [new WS()])
          srcNode.peerBook.put(relayPeer)
          cb(err)
        })
      },
      (cb) => {
        PeerInfo.create((err, info) => {
          dstPeer = info
          dstPeer.multiaddr.add(`/ip4/0.0.0.0/tcp/${portBase++}`)
          dstNode = new TestNode(dstPeer, [new TCP()])
          srcNode.peerBook.put(relayPeer)
          cb(err)
        })
      }
    ], (err) => done(err)
    )
  })

  describe(`simple circuit tests`, function circuitTests () {
    beforeEach(function (done) {
      series([
        (cb) => {
          relayNode.start(cb)
        },
        (cb) => {
          srcNode.start(cb)
        },
        (cb) => {
          dstNode.start(cb)
        }
      ], (err) => done(err))
    })

    // afterEach(function circuitTests (done) {
    //   series([
    //     (cb) => {
    //       srcNode.stop(cb)
    //     },
    //     (cb) => {
    //       dstNode.stop(cb)
    //     },
    //     (cb) => {
    //       relayNode.stop(cb)
    //     }
    //   ], (err) => done(err))
    // })

    it(`should connect to relay`, function (done) {
      function hello (protocol, conn) {
        pull(
          conn,
          pull.map((data) => {
            return data.toString().split('').reverse().join('')
          }),
          conn
        )
      }

      srcNode.dialByPeerInfo(relayPeer, (err) => {
        if (err) {
          done(err)
        }

        // srcNode.swarm.emit('peer-mux-established', relayPeer)
        srcNode.handle('/ipfs/reverse/1.0.0', hello)

        dstNode.dialByPeerInfo(relayPeer, (err) => {
          if (err) {
            return done(err)
          }

          // dstNode.swarm.emit('peer-mux-established', relayPeer)

          dstNode.dialByPeerInfo(srcPeer, '/ipfs/reverse/1.0.0', (err, conn) => {
            if (err) {
              return done(err)
            }

            pull(
              pull.values([new Buffer('hello')]),
              conn,
              pull.collect((err, data) => {
                expect(data[0].toString()).to.equal('olleh')
                done(err)
              })
            )
          })
        })
      })
    })
  })
}).timeout(500000)
