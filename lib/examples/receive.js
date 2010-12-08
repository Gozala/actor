'use strict'

var Actor = require('actor').Actor
,   setTimeout = require('event-queue').setTimeout

exports.actor = Actor(function actor() {
  var message = this.receive()
    , name = this.receive()

  console.log('< Waiting for messages')
  console.log('< ' + (yield message) + ' ' + (yield name))
})

exports.example = function() {
  console.log('> Executing an actor')
  var actor = exports.actor()
  setTimeout(function act() {
    actor.send('Hello')
    actor.send('Actor')
  }, 300)
  console.log('> We will send messages to actor in 300ms.')
}
