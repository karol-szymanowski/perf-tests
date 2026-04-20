var app = angular.module('PerfDashApp', ['ngMaterial', 'ngRoute', 'chart.js']);

var PerfDashApp = function (http, scope, route, timeout) {
    this.http = http;
    this.scope = scope;
    this.route = route;
    this.timeout = timeout;
    this.jobNames = [];
    this.selectedJobs = [];
    this.selectedJobMap = {};
    this.selectedJobColors = {};
    this.limitBuilds = 0;
    this.showAdvancedFilters = true; // Show by default on this page
    this.charts = [];
    this.jobsData = {};
    this.availableLabels = {};
    this.selectedLabels = {};
    this.loading = true;
    this.buildsDataCache = {};
    this.debounceTimeout = null;
    this.hideFailedRuns = false;

    var search = window.location.search;
    var params = new URLSearchParams(search);
    var jobsParam = params.get("jobname");
    this.selectedJobs = jobsParam ? jobsParam.split(",") : [];
    this.metricCategoryName = params.get("metriccategoryname");
    this.metricName = params.get("metricname");
    var limitParam = params.get("limitbuilds");
    this.limitBuilds = limitParam ? parseInt(limitParam) : 20;
    var seriesParam = params.get("selectedseries");
    this.initialSelectedSeries = seriesParam ? seriesParam.split(",") : null;

    params.forEach(function (value, name) {
        if (name !== "jobname" && name !== "metriccategoryname" && name !== "metricname" && name !== "limitbuilds" && name !== "selectedseries") {
            this.selectedLabels[name] = value;
        }
    }, this);

    this.http.get("/config").success(function (data) {
        this.config = data;
    }.bind(this));

    this.refresh();
};

PerfDashApp.prototype.refresh = function () {
    this.http.get("/jobnames")
        .success(function (data) {
            this.jobNames = data;
            if (this.selectedJobs.length === 0) {
                this.selectedJobs = [this.jobNames[0]];
            }
            this.selectedJobMap = {};
            for (var k = 0; k < this.selectedJobs.length; k++) {
                this.selectedJobMap[this.selectedJobs[k]] = true;
            }
            this.fetchAllData();
        }.bind(this))
        .error(function (data) {
            console.log("error fetching job names", data);
        });
};

PerfDashApp.prototype.fetchAllData = function () {
    var app = this;
    app.loading = true;
    this.http.get("/allbuildsdata")
        .success(function (data) {
            app.allData = data;
            app.loading = false;
            app.fetchMetricData();
        })
        .error(function (data) {
            console.log("error fetching all data", data);
            app.loading = false;
        });
};

PerfDashApp.prototype.fetchMetricData = function () {
    if (!this.metricName) {
        console.log("Missing metric name");
        return;
    }
    var app = this;
    if (!this.metricCategoryName || this.metricCategoryName === "undefined") {
        app.inferCategoryAndFetch();
        return;
    }
    
    if (!app.allData) return;

    app.jobsData = {};
    app.charts = [];

    angular.forEach(app.selectedJobs, function (jobName) {
        if (app.allData[jobName] && app.allData[jobName][app.metricCategoryName] && app.allData[jobName][app.metricCategoryName][app.metricName]) {
            app.jobsData[jobName] = app.allData[jobName][app.metricCategoryName][app.metricName];
        }
    });

    app.processData();
};

PerfDashApp.prototype.inferCategoryAndFetch = function () {
    var app = this;
    if (!app.allData) return;
    
    var found = false;
    angular.forEach(app.selectedJobs, function (jobName) {
        if (found || !app.allData[jobName]) return;
        angular.forEach(app.allData[jobName], function (metrics, cat) {
            if (found) return;
            if (metrics[app.metricName]) {
                app.metricCategoryName = cat;
                found = true;
                console.log("Inferred category:", cat);
                app.fetchMetricData();
            }
        });
    });
};

PerfDashApp.prototype.processData = function () {
    var app = this;
    app.extractAvailableLabels();
    app.buildCharts();
    app.loading = false;
};

PerfDashApp.prototype.extractAvailableLabels = function () {
    var app = this;
    var labelSet = {};
    var seriesSet = {};
    angular.forEach(this.jobsData, function (jobData) {
        if (!jobData || !jobData.builds) return;
        angular.forEach(jobData.builds, function (items, build) {
            angular.forEach(items, function (item) {
                angular.forEach(item.labels, function (label, name) {
                    if (labelSet[name] == undefined) {
                        labelSet[name] = {}
                    }
                    labelSet[name][label] = true
                });
                if (item.data) {
                    angular.forEach(item.data, function (value, name) {
                        seriesSet[name] = true;
                    });
                }
            });
        });
    });

    app.availableLabels = {};
    angular.forEach(labelSet, function (items, name) {
        app.availableLabels[name] = Object.keys(items).sort();
    });

    app.availableSeries = Object.keys(seriesSet).sort().reverse();
    if (!app.selectedSeriesMap || Object.keys(app.selectedSeriesMap).length === 0) {
        app.selectedSeriesMap = {};
        angular.forEach(app.availableSeries, function (s) {
            if (app.initialSelectedSeries) {
                app.selectedSeriesMap[s] = app.initialSelectedSeries.indexOf(s) !== -1;
            } else {
                app.selectedSeriesMap[s] = true;
            }
        });
    }
};

PerfDashApp.prototype.getLabelCombinations = function () {
    var app = this;
    var combinations = [];
    var seen = {};

    angular.forEach(this.jobsData, function (jobData) {
        if (!jobData || !jobData.builds) return;
        angular.forEach(jobData.builds, function (items, build) {
            angular.forEach(items, function (item) {
                if (!item.labels) return;
                var key = JSON.stringify(item.labels);
                if (!seen[key]) {
                    seen[key] = true;
                    combinations.push(item.labels);
                }
            });
        });
    });

    return combinations;
};

PerfDashApp.prototype.buildCharts = function () {
    var app = this;
    app.charts = [];
    app.updateChartColors();

    var combinations = app.getLabelCombinations();
    var maxBuilds = app.getMaxBuilds();

    angular.forEach(combinations, function (labels) {
        // Check if this combination matches the sidebar filters
        var filterMatch = true;
        angular.forEach(app.selectedLabels, function (value, name) {
            if (value && labels[name] !== value) {
                filterMatch = false;
            }
        });
        if (!filterMatch) return;

        var title = [];
        angular.forEach(labels, function (v, k) {
            title.push(k + "=" + v);
        });
        var chartTitle = title.join(", ") || "Default";

        var jobResults = {};
        var paddedJobBuildNumbers = {};
        var allSeriesLabels = [];
        var options = null;

        angular.forEach(app.selectedJobs, function (jobName) {
            var jobData = app.jobsData[jobName];
            if (jobData && jobData.builds) {
                var res = app.getDataForLabels(jobData, labels);
                jobResults[jobName] = res;

                var builds = Object.keys(jobData.builds);
                builds.sort(function (a, b) { return parseInt(a) - parseInt(b); });
                while (builds.length < maxBuilds) {
                    builds.unshift(null);
                }
                paddedJobBuildNumbers[jobName] = builds;

                for (var a = 0; a < res.length; a++) {
                    if ("unit" in res[a] && "data" in res[a] && res[a].data != {}) {
                        options = { scaleLabel: "<%=value%> " + res[a].unit, animation: false, responsive: true, maintainAspectRatio: false, pointDot: true, pointDotRadius: 5 };
                        allSeriesLabels = allSeriesLabels.concat(Object.keys(res[a].data));
                    }
                }
            }
        });

        if (!options) return; // No data for this variation

        var seriesLabels = [];
        angular.forEach(app.availableSeries, function (s) {
            if (app.selectedSeriesMap[s]) {
                seriesLabels.push(s);
            }
        });

        var chart = {
            id: app.metricName + "_" + JSON.stringify(labels),
            title: chartTitle,
            seriesData: [],
            series: [],
            chartColors: [],
            builds: [],
            options: options,
            jobBuildNumbers: paddedJobBuildNumbers,
            seriesLabels: seriesLabels,
            noData: true
        };

        for (var i = 0; i < maxBuilds; i++) {
            chart.builds.push("Run " + (i + 1));
        }

        var limit = app.limitBuilds;
        if (limit > 0 && limit < maxBuilds) {
            chart.builds = chart.builds.slice(maxBuilds - limit);
        }

        var colorIdx = 0;
        var palette = [
            [56, 189, 248],  // Blue
            [129, 140, 248], // Purple
            [52, 211, 153],  // Green
            [248, 113, 113], // Red
            [250, 204, 21],  // Yellow
            [156, 163, 175]  // Grey
        ];

        angular.forEach(app.selectedJobs, function (jobName) {
            var res = jobResults[jobName];
            if (!res) return;
            var rgb = palette[colorIdx % palette.length];
            colorIdx++;

            angular.forEach(seriesLabels, function (name) {
                var stream = app.getStream(res, name);
                while (stream.length < maxBuilds) {
                    stream.unshift(null);
                }
                var slicedStream = stream;
                if (limit > 0 && limit < maxBuilds) {
                    slicedStream = stream.slice(maxBuilds - limit);
                }
                chart.seriesData.push(slicedStream);
                chart.series.push(jobName + " - " + name);

                angular.forEach(slicedStream, function (val) {
                    if (val !== 0 && val !== null) {
                        chart.noData = false;
                    }
                });
            });
        });

        if (!chart.noData) {
            app.charts.push(chart);
        }
    });
    app.updateChartColors();
};

PerfDashApp.prototype.getMaxBuilds = function () {
    var max = 0;
    angular.forEach(this.jobsData, function (jobData) {
        if (jobData && jobData.builds) {
            var len = Object.keys(jobData.builds).length;
            if (len > max) max = len;
        }
    });
    return max;
};

PerfDashApp.prototype.getBackToCategoryUrl = function () {
    var jobs = this.selectedJobs.join(',');
    var cat = encodeURIComponent(this.metricCategoryName);
    return 'index.html#/?jobname=' + jobs + '&metriccategoryname=' + cat;
};

PerfDashApp.prototype.setURLParameters = function () {
    var newParams = {};
    newParams["jobname"] = this.selectedJobs.join(",");
    newParams["metriccategoryname"] = this.metricCategoryName;
    newParams["metricname"] = this.metricName;
    newParams["limitbuilds"] = this.limitBuilds;

    var selectedSeries = [];
    angular.forEach(this.selectedSeriesMap, function (selected, name) {
        if (selected) {
            selectedSeries.push(name);
        }
    });
    if (this.availableSeries && selectedSeries.length < this.availableSeries.length) {
        newParams["selectedseries"] = selectedSeries.join(",");
    }

    angular.forEach(this.selectedLabels, function (value, name) {
        if (value) {
            newParams[name] = value;
        }
    });

    this.route.updateParams(newParams);
};

PerfDashApp.prototype.getDataForLabels = function (jobData, labels) {
    var result = [];
    if (!jobData || !jobData.builds) return result;

    var builds = Object.keys(jobData.builds);
    builds.sort(function (a, b) { return parseInt(a) - parseInt(b); });

    angular.forEach(builds, function (build) {
        if (this.hideFailedRuns && jobData.buildStatus && jobData.buildStatus[build] === "FAILURE") {
            result.push({ failed: true });
            return;
        }
        var items = jobData.builds[build];
        var hasAnyResult = false;
        angular.forEach(items, function (item) {
            var match = true;
            angular.forEach(labels, function (label, name) {
                if (item.labels == undefined || item.labels[name] != label) {
                    match = false;
                }
            });
            if (match) {
                result.push(item);
                hasAnyResult = true;
            }
        });
        if (!hasAnyResult) {
            result.push({});
        }
    }, this);
    return result;
};

PerfDashApp.prototype.getStream = function (data, stream) {
    var result = [];
    angular.forEach(data, function (value) {
        var x = undefined
        if (value && value.failed) {
            x = null;
        } else if ("data" in value) {
            x = value.data[stream];
        }
        if (x == undefined) {
            x = 0;
        }
        result.push(x);
    });
    return result;
};

PerfDashApp.prototype.getChartColor = function (r, g, b, alpha) {
    return {
        fillColor: "rgba(0,0,0,0)",
        strokeColor: "rgba(" + r + "," + g + "," + b + "," + alpha + ")",
        pointColor: "rgba(" + r + "," + g + "," + b + "," + alpha + ")",
        pointStrokeColor: "#fff",
        pointHighlightFill: "#fff",
        pointHighlightStroke: "rgba(" + r + "," + g + "," + b + "," + alpha + ")"
    };
};

PerfDashApp.prototype.updateChartColors = function () {
    var app = this;
    var palette = [
        [56, 189, 248],  // Blue
        [129, 140, 248], // Purple
        [52, 211, 153],  // Green
        [248, 113, 113], // Red
        [250, 204, 21],  // Yellow
        [156, 163, 175]  // Grey
    ];

    var colorIdx = 0;
    angular.forEach(app.selectedJobs, function (jobName) {
        var rgb = palette[colorIdx % palette.length];
        colorIdx++;
        app.selectedJobColors[jobName] = "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";
    });

    angular.forEach(this.charts, function (chart) {
        chart.chartColors = [];
        var colorIdx = 0;

        var validSelectedJobs = [];
        for (var i = 0; i < app.selectedJobs.length; i++) {
            if (app.selectedJobs[i]) validSelectedJobs.push(app.selectedJobs[i]);
        }
        var multiJob = validSelectedJobs.length > 1;

        if (multiJob) {
            angular.forEach(validSelectedJobs, function (jobName, idx) {
                var baseRgb = palette[colorIdx % palette.length];
                colorIdx++;

                var alpha = 0.3; // default
                if (app.hoveredJob) {
                    alpha = (jobName === app.hoveredJob) ? 1.0 : 0.05;
                } else if (app.mainJobName) {
                    alpha = (jobName === app.mainJobName) ? 1.0 : 0.3;
                } else if (idx === 0) {
                    alpha = 1.0; // fallback to first job if no main set
                }

                angular.forEach(chart.seriesLabels, function (name, seriesIdx) {
                    var factor = 1.0 - (seriesIdx * 0.2);
                    if (factor < 0.2) factor = 0.2;
                    var r = Math.floor(baseRgb[0] * factor);
                    var g = Math.floor(baseRgb[1] * factor);
                    var b = Math.floor(baseRgb[2] * factor);
                    chart.chartColors.push(app.getChartColor(r, g, b, alpha));
                });
            });
        } else {
            var jobName = validSelectedJobs[0];
            var baseRgb = palette[0]; // Use first color for single job
            angular.forEach(chart.seriesLabels, function (name, seriesIdx) {
                var factor = 1.0 - (seriesIdx * 0.2);
                if (factor < 0.2) factor = 0.2;
                var r = Math.floor(baseRgb[0] * factor);
                var g = Math.floor(baseRgb[1] * factor);
                var b = Math.floor(baseRgb[2] * factor);
                chart.chartColors.push(app.getChartColor(r, g, b, 1.0));
            });
        }
    });
};
PerfDashApp.prototype.onLegendHover = function (jobName) {
    this.hoveredJob = jobName;
    this.updateChartColors();
};

PerfDashApp.prototype.onLegendBlur = function () {
    this.hoveredJob = null;
    this.updateChartColors();
};

PerfDashApp.prototype.onLegendClick = function (jobName) {
    this.mainJobName = jobName;
    this.updateChartColors();
};

PerfDashApp.prototype.onLabelFilterChange = function () {
    var app = this;
    if (this.debounceTimeout) {
        this.timeout.cancel(this.debounceTimeout);
    }
    this.debounceTimeout = this.timeout(function () {
        app.buildCharts();
        app.setURLParameters();
    }, 500);
};

PerfDashApp.prototype.onSeriesFilterChange = function () {
    var app = this;
    if (this.debounceTimeout) {
        this.timeout.cancel(this.debounceTimeout);
    }
    this.debounceTimeout = this.timeout(function () {
        app.buildCharts();
        app.setURLParameters();
    }, 500);
};

PerfDashApp.prototype.syncSelectedJobs = function () {
    this.selectedJobs = [];
    for (var i = 0; i < this.jobNames.length; i++) {
        var j = this.jobNames[i];
        if (this.selectedJobMap[j]) {
            this.selectedJobs.push(j);
        }
    }
    this.fetchMetricData();
    this.setURLParameters();
};

PerfDashApp.prototype.toggleAllJobs = function (checked) {
    this.selectedJobs = [];
    for (var i = 0; i < this.jobNames.length; i++) {
        var j = this.jobNames[i];
        this.selectedJobMap[j] = !!checked;
        if (checked) {
            this.selectedJobs.push(j);
        }
    }
    this.fetchMetricData();
    this.setURLParameters();
};

PerfDashApp.prototype.onLimitBuildsChange = function () {
    this.buildCharts();
    this.setURLParameters();
};

PerfDashApp.prototype.onHideFailedRunsChange = function () {
    this.buildCharts();
};

app.controller('AppCtrl', ['$scope', '$http', '$interval', '$route', '$timeout', function ($scope, $http, $interval, $route, $timeout) {
    $scope.controller = new PerfDashApp($http, $scope, $route, $timeout);
}]);

app.config(function ($routeProvider) {
    $routeProvider.when('/', { reloadOnSearch: false })
});
