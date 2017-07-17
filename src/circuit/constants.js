'use strict'

module.exports = {
  DIALER: {
    ONION: 'onion',
    TELESCOPE: 'telescope'
  },
  RESPONSE: {
    SUCCESS: 100,
    HOP: {
      SRC_ADDR_TOO_LONG: 220,
      DST_ADDR_TOO_LONG: 221,
      SRC_MULTIADDR_INVALID: 250,
      DST_MULTIADDR_INVALID: 251,
      NO_CONN_TO_DST: 260,
      CANT_DIAL_DST: 261,
      CANT_OPEN_DST_STREAM: 262,
      CANT_SPEAK_RELAY: 270,
      CANT_CONNECT_TO_SELF: 280,
      MSG_TO_LONG: 290
    },
    STOP: {
      SRC_ADDR_TOO_LONG: 320,
      DST_ADDR_TOO_LONG: 321,
      SRC_MULTIADDR_INVALID: 350,
      DST_MULTIADDR_INVALID: 351,
      MSG_TO_LONG: 350
    }
  }
}
