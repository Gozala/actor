'use strict'

exports.example = require('actors').Actor(function actor() {
  var message = actor.receive()
    , name = actor.receive()

  console.log((yield message) + ' ' + (yield name))
})
