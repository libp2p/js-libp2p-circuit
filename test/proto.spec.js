/* eslint-env mocha */
'use strict'

const expect = require('chai').expect

const proto = require('../src/protocol')

describe('protocol', function () {
  let msgObject = null
  let message = null

  before(() => {
    msgObject = {
      version: '1.0.0',
      message: {
        type: proto.Circuit.MessageType.HOP,
        source: {
          id: 'QmSource',
          address: [
            '/p2p-circuit/ipfs/QmSource',
            '/p2p-circuit/ipv4/0.0.0.0/9000/ipfs/QmSource',
            'ipv4/0.0.0.0/9000/ipfs/QmSource'
          ]
        },
        dest: {
          id: 'QmDest',
          address: [
            '/p2p-circuit/ipfs/QmDest',
            '/p2p-circuit/ipv4/1.1.1.1/9000/ipfs/QmDest',
            'ipv4/1.1.1.1/9000/ipfs/QmDest'
          ]
        }
      }
    }

    let buff = proto.Circuit.encode(msgObject)
    message = proto.Circuit.decode(buff)
  })

  it(`version should match`, () => {
    expect(message.version).to.equal('1.0.0')
  })

  it(`should source and dest`, () => {
    expect(message.message.source).to.not.be.null
    expect(message.message.dest).to.not.be.null
  })

  it(`should encode message`, () => {
    expect(message.message).to.deep.equal(msgObject.message)
  })
})
