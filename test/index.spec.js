/* eslint-env mocha */
'use strict'

const Node = require('libp2p-ipfs-nodejs')
const PeerInfo = require('peer-info')
const series = require('async/series')
const pull = require('pull-stream')

const Relay = require('../src').Relay
const Dialer = require('../src').Dialer
const Listener = require('../src').Listener

const expect = require('chai').expect

describe(`test circuit`, function () {
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
    this.timeout(50000)

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
      }],
      (err) => done(err)
    )
  })

  describe(`simple circuit tests`, function circuitTests () {
    beforeEach(function (done) {
      series([
        (cb) => {
          srcNode.start(cb)
        },
        (cb) => {
          dstNode.start(cb)
        },
        (cb) => {
          relayNode.start(cb)
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
        }
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
        },
        (cb) => {
          relayCircuit.stop()
          relayCircuit = null
          dialer = null
          cb()
        }
      ], (err) => done(err))
    })

    it(`source should be able to write/read to dest over relay`, function (done) {
      listener = new Listener(dstNode, (conn) => {
        pull(
          conn,
          pull.map((data) => {
            return data.toString().split('').reverse().join('')
          }),
          conn
        )
      })

      listener.listen()

      dialer.dial(dstPeer, (err, conn) => {
        if (err) {
          done(err)
        }

        pull(
          pull.values(['hello']),
          conn,
          pull.collect((err, data) => {
            expect(data[0].toString()).to.equal('olleh')
            listener.close()
            done(err)
          })
        )
      })
    })

    it(`destination should be able to write/read to source over relay`, function (done) {
      listener = new Listener(dstNode, (conn) => {
        pull(
          pull.values(['hello']),
          conn,
          pull.collect((err, data) => {
            expect(data[0].toString()).to.equal('olleh')
            listener.close()
            done(err)
          })
        )
      })

      listener.listen()

      dialer.dial(dstPeer, (err, conn) => {
        if (err) {
          done(err)
        }
        pull(
          conn,
          pull.map((data) => {
            return data.toString().split('').reverse().join('')
          }),
          conn
        )
      })
    })
  })
})
