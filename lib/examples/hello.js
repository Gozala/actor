/* vim:set ts=2 sw=2 sts=2 et autoread */
'use strict';var Actor, Deferred, When, getNameAsync, setTimeout, _ref;
_ref = require('q'), When = _ref.when, Deferred = _ref.defer;
Actor = require('actor').Actor;
setTimeout = require('event-queue').setTimeout;
getNameAsync = function(name, time) {
  var promise, resolve, _ref;
  if (name == null) {
    name = 'User';
  }
  if (time == null) {
    time = 1000;
  }
  _ref = new Deferred, resolve = _ref.resolve, promise = _ref.promise;
  setTimeout(resolve, time, name);
  return promise;
};
exports.actor = new Actor(function(name, time) {
  console.log('>>> Task started');
  console.log('Hello ' + (yield(getNameAsync(name, time))));
  console.log('<<< Task finished');
});
exports.example = function(name, time) {
  return exports.actor.start(name, time);
};