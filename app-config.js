(function (global) {
  'use strict';

  const environments = Object.freeze({
    master: Object.freeze({
      branch: 'master',
      frontendUrl: 'https://trip-planner.tsai212224.workers.dev/',
      apiUrl: 'https://script.google.com/macros/s/AKfycbygKTfIk0pqval3Df8Y2Xj_HhJMpYCiu_FvZzyEQWEdXSoaEYhOoV3Ga-_yLqwSZlzk/exec'
    }),
    dev: Object.freeze({
      branch: 'dev',
      frontendUrl: 'https://test.tsai212224.workers.dev/',
      apiUrl: 'https://script.google.com/macros/s/AKfycbxsv6YDMP_j3zm7WSgPx0wAPaqdc1D3UOIBhF7wd0HsRuwF0rX833v-JbeQeXoiXeR1iQ/exec'
    })
  });

  const environmentByHostname = Object.freeze({
    'test.tsai212224.workers.dev': 'dev',
    'trip-planner.tsai212224.workers.dev': 'master',
    'localhost': 'dev',
    '127.0.0.1': 'dev'
  });

  const hostname = String(global.location?.hostname || '').toLowerCase();
  // 未知網域與直接開啟本機檔案時預設連至 dev，避免誤寫正式資料。
  const environment = environmentByHostname[hostname] || 'dev';

  global.TRIP_PLANNER_CONFIG = Object.freeze({
    environment,
    ...environments[environment]
  });
})(window);
