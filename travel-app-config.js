(function (global) {
  'use strict';

  global.TRIP_PLANNER_CONFIG = Object.freeze({
    environment: 'travel',
    branch: 'feature/旅遊用途',
    frontendUrl: global.location?.origin ? `${global.location.origin}/` : '',
    apiUrl: 'https://script.google.com/macros/s/AKfycbzv9NHpHbOTQTdlhixtkYwgmmLJvNDo2QUqxKXN-c3d6O1KIOsJ62OlUjCaGiXOPrdERw/exec'
  });
})(window);
