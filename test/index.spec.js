/* eslint-env mocha */
'use strict'

const PeerInfo = require('peer-info')
const series = require('async/series')
const parallel = require('async/parallel')
const pull = require('pull-stream')
const Libp2p = require('libp2p')

const TCP = require('libp2p-tcp')
const WS = require('libp2p-websockets')
const spdy = require('libp2p-spdy')
const multiplex = require('libp2p-multiplex')
const waterfall = require('async/waterfall')

const expect = require('chai').expect

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

describe('test non common transports over relay', function () {
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
            relayNode = new TestNode(relayPeer, [new TCP(), new WS()], {relay: true})
            cb(err)
          })
        },
        (cb) => {
          PeerInfo.create((err, info) => {
            srcPeer = info
            srcPeer.multiaddr.add(`/ip4/0.0.0.0/tcp/${portBase++}`)
            srcNode = new TestNode(srcPeer, [new TCP()])
            srcNode.peerBook.put(relayPeer)
            cb(err)
          })
        },
        (cb) => {
          PeerInfo.create((err, info) => {
            dstPeer = info
            dstPeer.multiaddr.add(`/ip4/0.0.0.0/tcp/${portBase++}/ws`)
            dstNode = new TestNode(dstPeer, [new WS()])
            srcNode.peerBook.put(relayPeer)
            cb(err)
          })
        }
      ], (err) => done(err)
    )
  })

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
      },
      (cb) => relayNode.dialByPeerInfo(dstPeer, (err, conn) => {
        cb()
      }),
      (cb) => relayNode.dialByPeerInfo(srcPeer, (err, conn) => {
        cb()
      })
    ], (err) => done(err))
  })

  afterEach(function circuitTests (done) {
    series([
      (cb) => {
        srcNode.stop(cb)
      },
      (cb) => {
        dstNode.stop(cb)
      },
      (cb) => {
        relayNode.stop(cb)
      }
    ], (err) => done(err))
  })

  it('should dial to a node over a relay and write a value', function (done) {
    this.timeout(500000)

    function reverse (protocol, conn) {
      pull(
        conn,
        pull.map((data) => {
          return data.toString().split('').reverse().join('')
        }),
        conn
      )
    }

    dstNode.dialByPeerInfo(srcPeer, '/ipfs/reverse/1.0.0', (err, conn) => {
      if (err) return done(err)
      pull(
        pull.values(['hello']),
        conn,
        pull.collect((err, data) => {
          if (err) return cb(err)

          expect(data[0].toString()).to.equal('olleh')
          done()
        }))
    })

    srcNode.handle('/ipfs/reverse/1.0.0', reverse)
  })

  it('should dial to a node over a relay and write several values', function (done) {
    this.timeout(500000)

    function reverse (protocol, conn) {
      pull(
        conn,
        pull.map((data) => {
          return data.toString().split('').reverse().join('')
        }),
        conn
      )
    }

    srcNode.handle('/ipfs/reverse/1.0.0', reverse)
    waterfall([
      (cb) => srcNode.dialByPeerInfo(relayPeer, () => {
        cb()
      }),
      (cb) => dstNode.dialByPeerInfo(relayPeer, () => {
        cb()
      }),
      (cb) => {
        waterfall([
          // TODO: make sure the WebSockets dials first, because TCP hangs the stream!!! possibly a bug in TCP....
          (cb) => {
            dstNode.dialByPeerInfo(srcPeer, '/ipfs/reverse/1.0.0', (err, conn) => {
              if (err) return cb(err)
              pull(
                pull.values(['hello', 'hello1', 'hello2', 'hello3']),
                conn,
                pull.collect((err, data) => {
                  if (err) return cb(err)

                  expect(data[0].toString()).to.equal('olleh')
                  expect(data[1].toString()).to.equal('1olleh')
                  expect(data[2].toString()).to.equal('2olleh')
                  expect(data[3].toString()).to.equal('3olleh')
                  cb()
                }))
            })
          }
        ], done)
      }
    ])
  })
})