var app = angular.module('PerfDashApp', ['ngMaterial', 'ngRoute']);

app.config(function ($routeProvider) {
    $routeProvider.when('/', { reloadOnSearch: false })
});

var PerfDashApp = function (http, scope, route, timeout) {
    this.http = http;
    this.scope = scope;
    this.route = route;
    this.timeout = timeout;
    
    var search = window.location.search || window.location.hash;
    var queryIdx = search.indexOf('?');
    var params = new URLSearchParams(queryIdx !== -1 ? search.substring(queryIdx + 1) : "");
    
    this.buildId = params.get("buildid") || "";
    this.resolvedJob = params.get("jobname") || "";
    this.aggMethod = params.get("aggmethod") || "median";
    this.filterFailed = params.get("filterfailed") !== "false";
    this.limitBuilds = params.get("limitbuilds") ? parseInt(params.get("limitbuilds")) : 20;

    this.loading = true;
    this.error = "";
    this.diffResults = [];
    this.allData = null;
    this.jobNames = [];
    this.recentBuilds = [];
    this.collapsedMetrics = {};

    this.fetchAllData();
};

PerfDashApp.prototype.fetchAllData = function () {
    var app = this;
    app.loading = true;
    this.http.get("/allbuildsdata")
        .success(function (data) {
            app.allData = data;
            app.loading = false;
            app.jobNames = Object.keys(data).sort();
            if (app.resolvedJob && app.buildId) {
                app.onScenarioChange(true);
            } else if (app.jobNames.length > 0) {
                app.resolvedJob = app.jobNames[0];
                app.onScenarioChange();
            }
        })
        .error(function (data) {
            console.log("error fetching all data", data);
            app.error = "Failed to load data from server.";
            app.loading = false;
        });
};

PerfDashApp.prototype.onScenarioChange = function (keepBuildId) {
    var app = this;
    app.recentBuilds = [];
    if (!keepBuildId) app.buildId = "";
    app.diffResults = [];

    if (!app.resolvedJob || !app.allData || !app.allData[app.resolvedJob]) return;

    var jobData = app.allData[app.resolvedJob];
    var buildSet = {};
    var buildStatus = {};
    var buildTimestamps = {};

    angular.forEach(jobData, function (metrics) {
        angular.forEach(metrics, function (buildData) {
            if (buildData && buildData.builds) {
                angular.forEach(buildData.builds, function (items, build) {
                    buildSet[build] = true;
                });
            }
            if (buildData && buildData.buildStatus) {
                angular.forEach(buildData.buildStatus, function (status, build) {
                    buildStatus[build] = status;
                });
            }
            if (buildData && buildData.buildTimestamps) {
                angular.forEach(buildData.buildTimestamps, function (ts, build) {
                    buildTimestamps[build] = ts;
                });
            }
        });
    });

    var builds = Object.keys(buildSet).sort(function(a, b) {
        return parseInt(b) - parseInt(a);
    });

    if (builds.length > 20) {
        builds = builds.slice(0, 20);
    }

    var count = 1;
    angular.forEach(builds, function (build) {
        var status = buildStatus[build] || "SUCCESS";
        var ts = buildTimestamps[build];
        var dateStr = "";
        if (ts) {
            var date = new Date(ts * 1000);
            if (ts > 100000000000) {
                date = new Date(ts);
            }
            dateStr = " - " + date.toISOString().replace('T', ' ').substring(0, 16);
        }
        var label = count + ". " + build;
        if (status !== "SUCCESS") {
            label += " (" + status + ")";
        }
        label += dateStr;
        app.recentBuilds.push({ id: build, status: status, label: label });
        count++;
    });

    if (!keepBuildId && app.recentBuilds.length > 0) {
        app.buildId = app.recentBuilds[0].id;
    }
    app.calculateDiffs();
};

PerfDashApp.prototype.setURLParameters = function () {
    var newParams = {};
    newParams["jobname"] = this.resolvedJob;
    newParams["buildid"] = this.buildId;
    newParams["aggmethod"] = this.aggMethod;
    newParams["filterfailed"] = this.filterFailed;
    newParams["limitbuilds"] = this.limitBuilds;

    this.route.updateParams(newParams);
};

PerfDashApp.prototype.calculateDiffs = function () {
    var app = this;
    if (!app.buildId || !app.resolvedJob || !app.allData) return;

    app.setURLParameters();
    app.loading = true;
    app.diffResults = [];
    var jobData = app.allData[app.resolvedJob];
    var categories = Object.keys(jobData);
    var catIdx = 0;
    var groupedResults = {};

    function processNextCategory() {
        if (catIdx >= categories.length) {
            flattenAndFinish();
            return;
        }

        var catName = categories[catIdx];
        var metrics = jobData[catName];

        angular.forEach(metrics, function (buildData, metricName) {
            if (!buildData || !buildData.builds) return;

            var buildStatus = buildData.buildStatus || {};
            var variationMap = {};
            
            var targetItems = buildData.builds[app.buildId] || [];
            angular.forEach(targetItems, function (item) {
                if (!item.labels || !item.data) return;
                var labelKey = JSON.stringify(item.labels);
                
                angular.forEach(item.data, function (val, seriesName) {
                    var key = labelKey + '_' + seriesName;
                    if (!variationMap[key]) {
                        variationMap[key] = {
                            labels: item.labels,
                            seriesName: seriesName,
                            buildVal: val,
                            otherVals: [],
                            unit: item.unit || ""
                        };
                    }
                });
            });

            var otherBuilds = Object.keys(buildData.builds).sort(function(a, b) {
                return parseInt(b) - parseInt(a);
            });

            var count = 0;
            angular.forEach(otherBuilds, function (build) {
                if (count >= app.limitBuilds) return;
                if (build === app.buildId) return;

                if (app.filterFailed && buildStatus[build] && buildStatus[build] !== "SUCCESS") {
                    return;
                }

                var items = buildData.builds[build];
                angular.forEach(items, function (item) {
                    if (!item.labels || !item.data) return;
                    var labelKey = JSON.stringify(item.labels);
                    
                    angular.forEach(item.data, function (val, seriesName) {
                        var key = labelKey + '_' + seriesName;
                        if (variationMap[key]) {
                            variationMap[key].otherVals.push(val);
                        }
                    });
                });
                count++;
            });

            var catResults = [];
            angular.forEach(variationMap, function (v) {
                if (v.buildVal === null || v.buildVal === 0 || v.otherVals.length === 0) return;

                var aggVal = 0;
                if (app.aggMethod === "median") {
                    aggVal = app.calculateMedian(v.otherVals.slice());
                } else {
                    aggVal = app.calculateAverage(v.otherVals);
                }

                if (aggVal === 0) return;

                var diff = v.buildVal - aggVal;
                var diffPct = aggVal !== 0 ? (diff / aggVal) * 100 : 0;
                var alpha = Math.min(Math.abs(diffPct) / 50, 1.0);

                var labelsStr = [];
                angular.forEach(v.labels, function (val, name) {
                    labelsStr.push(name + "=" + val);
                });
                var labelsCombined = labelsStr.join(", ");

                catResults.push({
                    category: catName,
                    metricName: metricName,
                    metric: v.seriesName,
                    labels: labelsCombined,
                    buildVal: v.buildVal,
                    aggVal: aggVal,
                    diff: diff,
                    diffPct: diffPct,
                    unit: v.unit,
                    alpha: alpha
                });
            });

            if (catResults.length > 0) {
                if (!groupedResults[catName]) {
                    groupedResults[catName] = {};
                }
                if (!groupedResults[catName][metricName]) {
                    groupedResults[catName][metricName] = [];
                }
                groupedResults[catName][metricName] = groupedResults[catName][metricName].concat(catResults);
            }
        });

        catIdx++;
        app.timeout(processNextCategory, 0);
    }

    function flattenAndFinish() {
        var sortedCats = Object.keys(groupedResults).sort();
        angular.forEach(sortedCats, function (cat) {
            app.diffResults.push({ isHeader: true, category: cat });

            var sortedMetrics = Object.keys(groupedResults[cat]).sort();
            angular.forEach(sortedMetrics, function (met) {
                var maxSkew = 0;
                angular.forEach(groupedResults[cat][met], function (r) {
                    if (Math.abs(r.diffPct) > maxSkew) {
                        maxSkew = Math.abs(r.diffPct);
                    }
                });

                var alpha = Math.min(maxSkew / 50, 1.0);

                app.diffResults.push({ isSubHeader: true, category: cat, metric: met, maxSkew: maxSkew, alpha: alpha });
                var key = cat + '_' + met;
                if (app.collapsedMetrics[key] === undefined) {
                    app.collapsedMetrics[key] = true;
                }
                app.diffResults = app.diffResults.concat(groupedResults[cat][met]);
            });
        });
        app.loading = false;
    }

    processNextCategory();
};

PerfDashApp.prototype.toggleMetric = function (cat, met) {
    var key = cat + '_' + met;
    this.collapsedMetrics[key] = !this.collapsedMetrics[key];
};

PerfDashApp.prototype.collapseAll = function () {
    var app = this;
    angular.forEach(this.collapsedMetrics, function (val, key) {
        app.collapsedMetrics[key] = true;
    });
};

PerfDashApp.prototype.expandAll = function () {
    var app = this;
    angular.forEach(this.collapsedMetrics, function (val, key) {
        app.collapsedMetrics[key] = false;
    });
};

PerfDashApp.prototype.calculateMedian = function (values) {
    if (values.length === 0) return 0;
    values.sort(function(a, b) { return a - b; });
    var half = Math.floor(values.length / 2);
    if (values.length % 2) return values[half];
    return (values[half - 1] + values[half]) / 2.0;
};

PerfDashApp.prototype.calculateAverage = function (values) {
    if (values.length === 0) return 0;
    var sum = 0;
    for (var i = 0; i < values.length; i++) {
        sum += values[i];
    }
    return sum / values.length;
};

app.controller('AppCtrl', ['$scope', '$http', '$route', '$timeout', function ($scope, $http, $route, $timeout) {
    $scope.controller = new PerfDashApp($http, $scope, $route, $timeout);
}]);
