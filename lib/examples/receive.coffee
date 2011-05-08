### vim:set ts=2 sw=2 sts=2 et autoread ###

'use strict'

{ Actor } = require 'actor'
{ setTimeout } = require 'event-queue'

actor = exports.actor = new Actor ->
  firstName = this.receive 'firstname'
  lastnName = this.receive 'lastname'

  console.log '<<< Task will be suspended until messages arrive'
  console.log '<<< Hello ' + (yield firstName) + ' ' + (yield lastnName)
  console.log '<<< Task finished'
  return

exports.example = (firstName = 'awesome', lastnName = 'actor') ->
  actor.start()
  setTimeout ->
    actor.send 'firstname', firstName
    actor.send 'lastname', lastnName
  , 300
  console.log '>>> Will send a first name and last name in 300ms'