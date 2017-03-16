/* eslint-env mocha */
'use strict'

const PeerInfo = require('peer-info')
const series = require('async/series')
const pull = require('pull-stream')
const Libp2p = require('libp2p')

const TCP = require('libp2p-tcp')
const WS = require('libp2p-websockets')
const spdy = require('libp2p-spdy')
const waterfall = require('async/waterfall')

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

describe('circuit', function () {
  describe('test common transports', function () {
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
            relayNode = new TestNode(relayPeer, [new TCP(), new WS()])
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
            dstPeer.multiaddr.add(`/ip4/0.0.0.0/tcp/${portBase++}`)
            dstNode = new TestNode(dstPeer, [new TCP()])
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
        }
      ], (err) => done(err))
    })

    it('should dial from source to dest over common transports', function (done) {
      this.timeout(500000)

      const handleTestProto = (proto, conn) => {
        conn.getPeerInfo((err, peerInfo) => {
          if (err) {
            return done(err)
          }
          peerInfo.multiaddrs.forEach((ma) => {
            console.log(ma.toString())
          })

          pull(pull.values(['hello']), conn)
        })
      }

      srcNode.handle('/ipfs/test/1.0.0', handleTestProto)
      dstNode.handle('/ipfs/test/1.0.0', handleTestProto)

      waterfall([
        (cb) => srcNode.dialByPeerInfo(dstPeer, () => {
          cb()
        }),
        (cb) => dstNode.dialByPeerInfo(srcPeer, () => {
          cb()
        }),
        (cb) => {
          waterfall([
            (cb) => {
              srcNode.dialByPeerInfo(dstPeer, '/ipfs/test/1.0.0', (err, conn) => {
                if (err) return cb(err)

                conn.getPeerInfo((err, peerInfo) => {
                  if (err) return cb(err)

                  console.log(`from srcNode to relayNode:`)
                  peerInfo.multiaddrs.forEach((ma) => {
                    console.log(`src: ma of relay`, ma.toString())
                  })

                  pull(conn, pull.collect((err, data) => {
                    if (err) return cb(err)

                    data.forEach((dta) => {
                      console.log(dta.toString())
                    })
                    cb()
                  }))
                })
              })
            },
            (cb) => {
              dstNode.dialByPeerInfo(srcPeer, '/ipfs/test/1.0.0', (err, conn) => {
                if (err) return cb(err)

                conn.getPeerInfo((err, peerInfo) => {
                  if (err) return cb(err)

                  console.log(`from dstNode to relayNode:`)
                  peerInfo.multiaddrs.forEach((ma) => {
                    console.log(`dst: ma of relay`, ma.toString())
                  })

                  pull(conn, pull.collect((err, data) => {
                    if (err) return cb(err)

                    data.forEach((dta) => {
                      console.log(dta.toString())
                    })
                    cb()
                  }))
                })
              })
            }], done)
        }
      ])
    })
  })

  describe('test non common transports', function () {
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
            relayNode = new TestNode(relayPeer, [new TCP(), new WS()])
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
        }
      ], (err) => done(err))
    })

    it('should dial to a common node over different transports', function (done) {
      this.timeout(500000)

      const handleTestProto = (proto, conn) => {
        conn.getPeerInfo((err, peerInfo) => {
          if (err) {
            return done(err)
          }

          console.log(`handling test proto:`)
          peerInfo.multiaddrs.forEach((ma) => {
            console.log(ma.toString())
          })

          pull(pull.values(['hello']), conn)
        })
      }

      relayNode.handle('/ipfs/test/1.0.0', handleTestProto)
      waterfall([
        (cb) => srcNode.dialByPeerInfo(relayPeer, () => {
          cb()
        }),
        (cb) => dstNode.dialByPeerInfo(relayPeer, () => {
          cb()
        }),
        (cb) => {
          waterfall([
            // TODO: make sure the WebSockets node runs first, because TCP hangs the stream!!! possibly a bug....
            (cb) => {
              dstNode.dialByPeerInfo(relayPeer, '/ipfs/test/1.0.0', (err, conn) => {
                if (err) return cb(err)

                conn.getPeerInfo((err, peerInfo) => {
                  if (err) return cb(err)

                  console.log(`from dstNode to relayNode:`)
                  peerInfo.multiaddrs.forEach((ma) => {
                    console.log(`dst: ma of relay`, ma.toString())
                  })

                  pull(conn, pull.collect((err, data) => {
                    if (err) return cb(err)

                    data.forEach((dta) => {
                      console.log(dta.toString())
                    })
                    cb()
                  }))
                })
              })
            },
            (cb) => {
              srcNode.dialByPeerInfo(relayPeer, '/ipfs/test/1.0.0', (err, conn) => {
                if (err) return cb(err)

                conn.getPeerInfo((err, peerInfo) => {
                  if (err) return cb(err)

                  console.log(`from srcNode to relayNode:`)
                  peerInfo.multiaddrs.forEach((ma) => {
                    console.log(`src: ma of relay`, ma.toString())
                  })

                  pull(conn, pull.collect((err, data) => {
                    if (err) return cb(err)

                    data.forEach((dta) => {
                      console.log(dta.toString())
                    })
                    cb()
                  }))
                })
              })
            }
          ], done)
        }
      ])
    })
  })

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
            relayPeer.multiaddr.add(`/p2p-circuit`)
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
                  pull.values(['hello']),
                  conn,
                  pull.collect((err, data) => {
                    if (err) return cb(err)

                    expect(data[0].toString()).to.equal('olleh')
                    cb()
                  }))
              })
            }
          ], done)
        }
      ])
    })

    it('should dial to a node over a relay and write several value', function (done) {
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
})
