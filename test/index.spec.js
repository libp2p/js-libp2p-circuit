/* eslint-env mocha */
'use strict'

const Node = require('libp2p-ipfs-nodejs')
const PeerInfo = require('peer-info')
const series = require('async/series')
const parallel = require('async/parallel')
const pull = require('pull-stream')

const Relay = require('../src').Relay
const Dialer = require('../src').Dialer
const Listener = require('../src').Listener

const expect = require('chai').expect

describe(`test circuit`, () => {
  let srcNode
  let dstNode
  let relayNode

  let srcPeer
  let dstPeer
  let relayPeer

  let dialer
  let relayCircuit
  let listener

  let portBase = 9000 // TODO: randomize or mock sockets
  before((done) => {
    series([
      (cb) => {
        PeerInfo.create((err, info) => {
          srcPeer = info
          srcPeer.multiaddr.add(`/ip4/0.0.0.0/tcp/${portBase++}`)
          srcNode = new Node(srcPeer)
          cb(err)
        })
      },
      (cb) => {
        PeerInfo.create((err, info) => {
          dstPeer = info
          dstPeer.multiaddr.add(`/ip4/0.0.0.0/tcp/${portBase++}`)
          dstNode = new Node(dstPeer)
          cb(err)
        })
      },
      (cb) => {
        PeerInfo.create((err, info) => {
          relayPeer = info
          relayPeer.multiaddr.add(`/ip4/0.0.0.0/tcp/${portBase++}`)
          relayNode = new Node(relayPeer)
          cb(err)
        })
      },
      (cb) => {
        let relays = new Map()
        relays.set(relayPeer.id.toB58String(), relayPeer)
        dialer = new Dialer(srcNode, relays)
        cb()
      },
      (cb) => {
        relayCircuit = new Relay(relayNode)
        relayCircuit.start(cb)
      }],
      (err) => done(err)
    )
  })

  beforeEach((done) => {
    parallel([
      (cb) => {
        srcNode.start(cb)
      },
      (cb) => {
        dstNode.start(cb)
      },
      (cb) => {
        relayNode.start(cb)
      }
    ], (err) => done(err))
  })

  afterEach((done) => {
    parallel([
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

  it(`should connect to relay peer`, (done) => {
    listener = new Listener(dstNode, (conn) => {
      pull(
        conn,
        pull.map((data) => {
          return data.toString().split('').reverse().join('')
        }),
        conn
      )
    })

    listener.listen(() => {
    })

    dialer.dial(dstPeer, (err, conn) => {
      if (err) {
        done(err)
      }

      pull(
        pull.values(['hello']),
        conn,
        pull.collect((err, data) => {
          expect(data[0].toString()).to.equal('olleh')
          done(err)
        })
      )
    })
  }).timeout(50000)
})
