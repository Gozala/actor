/* vim:set ts=2 sw=2 sts=2 et autoread */
'use strict';var Actor, actor, setTimeout;
Actor = require('actor').Actor;
setTimeout = require('event-queue').setTimeout;
actor = exports.actor = new Actor(function() {
  var firstName, lastnName;
  firstName = this.receive('firstname');
  lastnName = this.receive('lastname');
  console.log('<<< Task will be suspended until messages arrive');
  console.log('<<< Hello ' + (yield(firstName)).value + ' ' + (yield(lastnName)).value);
  console.log('<<< Task finished');
});
exports.example = function(firstName, lastnName) {
  if (firstName == null) {
    firstName = 'awesome';
  }
  if (lastnName == null) {
    lastnName = 'actor';
  }
  actor.start();
  setTimeout(function() {
    actor.send({
      type: 'firstname',
      value: firstName
    });
    return actor.send({
      type: 'lastname',
      value: lastnName
    });
  }, 300);
  return console.log('>>> Will send a first name and last name in 300ms');
};