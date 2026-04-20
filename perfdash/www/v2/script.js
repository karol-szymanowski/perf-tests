/*
Copyright 2015 The Kubernetes Authors All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

var app = angular.module('PerfDashApp', ['ngMaterial', 'ngRoute', 'chart.js']);

var PerfDashApp = function (http, scope, route, timeout) {
    this.http = http;
    this.scope = scope;
    this.route = route;
    this.timeout = timeout;
    this.debounceTimeout = null;
    this.jobNames = [];
    this.selectedJobs = [];
    this.selectedJobMap = {};
    this.metricCategoryNames = [];
    this.metricNames = [];
    this.allSeriesLabels = [];
    this.selectedSeriesLabels = [];
    this.selectedSeriesMap = {};
    this.selectedLabels = {};
    this.selectedJobColors = {};
    this.searchResults = [];
    this.showSearchDropdown = false;
    this.allSearchItems = [];
    this.hideFailedRuns = false;
    this.limitBuilds = 20;
    this.showAdvancedFilters = false;
    this.chartSeriesCache = {};
    this.globalSelectedLabels = {};
    this.buildsDataCache = {};
    this.loading = false;
    this.onClick = this.onClickInternal_.bind(this);
    this.cap = 0;
    this.currentCall = 0;
    this.scope.$on('$routeChangeSuccess', this.routeChanged.bind(this));
    var app = this;
    this.http.get("/config").success(function (data) {
        app.config = data;
    });
    this.lastCall = { jobname: "", metriccategoryname: "", metricname: "", time: Date.now() };
    this.jobsData = {};
    this.routeChanged();
};

PerfDashApp.prototype.onClickInternal_ = function (data, evt, chartObj, chart) {
    console.log(this, data, evt, chart);
    if (evt.ctrlKey || evt.metaKey) {
        this.cap = (chart.scale.min + chart.scale.max) / 2;
        this.labelChanged();
        return;
    }

    this.setURLParameters();

    var runIndex = -1;
    if (data && data.length > 0 && data[0].label && data[0].label.startsWith("Run ")) {
        runIndex = parseInt(data[0].label.substring(4)) - 1;
    }

    if (runIndex < 0) return;

    var clickedJob = this.mainJobName || this.selectedJobs[0];

    var buildNumber = "";
    if (chartObj.jobBuildNumbers && chartObj.jobBuildNumbers[clickedJob]) {
        buildNumber = chartObj.jobBuildNumbers[clickedJob][runIndex];
    }

    if (!buildNumber) return;

    var jobNameForLogs = clickedJob;
    if (this.jobsData && this.jobsData[clickedJob] && this.jobsData[clickedJob].job) {
        jobNameForLogs = this.jobsData[clickedJob].job;
    }

    if (!this.config) {
        console.log("config not loaded yet");
        return;
    }
    window.open(this.config["storageURL"] + "/" +
        this.config["logsBucket"] + "/" +
        this.config["logsPath"] + "/" +
        jobNameForLogs + "/" +
        buildNumber + "/",
        "_blank");
};

// Fetch data from the server and update the data to display
PerfDashApp.prototype.refresh = function () {
    this.http.get("/jobnames")
        .success(function (data) {
            this.jobNames = data;
            if (this.selectedJobs === undefined || this.selectedJobs.length === 0) {
                this.selectedJobs = [this.jobNames[0]];
            } else {
                var validJobs = [];
                for (var i = 0; i < this.selectedJobs.length; i++) {
                    if (this.selectedJobs[i] && this.jobNames.indexOf(this.selectedJobs[i]) !== -1) {
                        validJobs.push(this.selectedJobs[i]);
                    }
                }
                this.selectedJobs = validJobs.length > 0 ? validJobs : [this.jobNames[0]];
            }
            this.selectedJobMap = {};
            for (var k = 0; k < this.selectedJobs.length; k++) {
                this.selectedJobMap[this.selectedJobs[k]] = true;
            }
            this.fetchAllData();
        }.bind(this))
        .error(function (data) {
            console.log("error fetching result");
            console.log(data);
        });
};

PerfDashApp.prototype.fetchAllData = function () {
    var app = this;
    app.loading = true;
    this.http.get("/allbuildsdata")
        .success(function (data) {
            app.allData = data;
            app.loading = false;
            app.jobNameChanged();
        })
        .error(function (data) {
            console.log("error fetching all data", data);
            app.loading = false;
        });
};

PerfDashApp.prototype.syncSelectedJobs = function () {
    this.selectedJobs = [];
    for (var i = 0; i < this.jobNames.length; i++) {
        var j = this.jobNames[i];
        if (this.selectedJobMap[j]) {
            this.selectedJobs.push(j);
        }
    }
    var app = this;
    if (this.debounceTimeout) {
        this.timeout.cancel(this.debounceTimeout);
    }
    this.debounceTimeout = this.timeout(function () {
        app.buildChartsForCategory();
    }, 500);
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
    this.jobNameChanged();
};

PerfDashApp.prototype.syncSelectedSeries = function () {
    this.selectedSeriesLabels = [];
    for (var i = 0; i < this.allSeriesLabels.length; i++) {
        var s = this.allSeriesLabels[i];
        if (this.selectedSeriesMap[s]) {
            this.selectedSeriesLabels.push(s);
        }
    }
    this.labelChanged();
};

PerfDashApp.prototype.toggleAllSeries = function (checked) {
    this.selectedSeriesLabels = [];
    for (var i = 0; i < this.allSeriesLabels.length; i++) {
        var s = this.allSeriesLabels[i];
        this.selectedSeriesMap[s] = !!checked;
        if (checked) {
            this.selectedSeriesLabels.push(s);
        }
    }
    this.labelChanged();
};

PerfDashApp.prototype.getQueryParams = function () {
    var params = this.route.current.params;
    var str = [];
    angular.forEach(params, function (value, key) {
        if (value) str.push(encodeURIComponent(key) + "=" + encodeURIComponent(value));
    });
    return str.length > 0 ? "?" + str.join("&") : "";
};

// Update the select drop-downs based on the query params.
PerfDashApp.prototype.routeChanged = function (event, data) {
    if (!this.route.current) return;
    var app = this;
    var labelsChanged = false;
    var categoryChanged = false;

    var search = window.location.search;
    if (search) {
        var params = new URLSearchParams(search);
        params.forEach(function (value, name) {
            if (name !== "jobname" && name !== "metriccategoryname" && name !== "limitbuilds" && name !== "selectedserieslabels") {
                if (app.globalSelectedLabels[name] !== value) {
                    app.globalSelectedLabels[name] = value;
                    labelsChanged = true;
                }
            }
        });
    }
    var hash = window.location.hash;
    var queryIdx = hash.indexOf('?');
    if (queryIdx !== -1) {
        var hashParams = new URLSearchParams(hash.substring(queryIdx + 1));
        var urlCat = hashParams.get("metriccategoryname");
        if (urlCat && app.selectedCategory !== urlCat) {
            app.selectedCategory = urlCat;
            app.selectedPath = urlCat;
            categoryChanged = true;
        }
    }

    angular.forEach(this.route.current.params, function (value, name) {
        switch (name) {
            case "jobname":
                var jobs = value.split(",");
                var changed = false;
                if (app.selectedJobs.length !== jobs.length) changed = true;
                else {
                    for (var i = 0; i < jobs.length; i++) {
                        if (app.selectedJobs[i] !== jobs[i]) changed = true;
                    }
                }
                if (changed) {
                    app.selectedJobs = jobs;
                    app.selectedJobMap = {};
                    for (var j = 0; j < jobs.length; j++) {
                        app.selectedJobMap[jobs[j]] = true;
                    }
                    app.jobNameChanged();
                }
                break;
            case "metriccategoryname":
                if (app.selectedCategory !== value) {
                    app.selectedCategory = value;
                    app.selectedPath = value;
                    categoryChanged = true;
                }
                break;
            case "limitbuilds":
                var val = parseInt(value);
                if (!isNaN(val) && app.limitBuilds !== val) {
                    app.limitBuilds = val;
                    app.onLimitBuildsChange();
                }
                break;
            case "selectedserieslabels":
                app.selectedSeriesLabels = value.split(",");
                break;
            default:
                if (app.globalSelectedLabels[name] !== value) {
                    app.globalSelectedLabels[name] = value;
                    labelsChanged = true;
                }
        }
    });
    if (categoryChanged) {
        this.onCategorySelected(this.selectedCategory);
    } else if (labelsChanged) {
        this.buildChartsForCategory(this.selectedCategory);
    } else {
        this.labelChanged();
    }
    this.v1Link = "/" + this.getQueryParams();
}

PerfDashApp.prototype.onSearchFocus = function () {
    this.originalPath = this.selectedPath;
    this.selectedPath = "";
    this.showSearchDropdown = true;
    this.onSearchChange(); // update results immediately
};

PerfDashApp.prototype.onSearchBlur = function () {
    var app = this;
    setTimeout(function () {
        app.scope.$apply(function () {
            app.showSearchDropdown = false;
            if (!app.selectedPath || !app.searchPathMap[app.selectedPath]) {
                app.selectedPath = app.originalPath;
            }
        });
    }, 200);
};

PerfDashApp.prototype.onSearchChange = function () {
    var query = this.selectedPath;
    var app = this;
    if (!query) {
        this.searchResults = this.allSearchItems.slice(0, 20); // show first 20 by default
        return;
    }

    var scored = [];
    angular.forEach(this.allSearchItems, function (item) {
        var score = app.fuzzyScore(item.label, query);
        if (score > 0) {
            scored.push({ item: item, score: score });
        }
    });

    scored.sort(function (a, b) { return b.score - a.score; });

    this.searchResults = scored.map(function (x) { return x.item; }).slice(0, 50); // limit to 50 results
};

PerfDashApp.prototype.fuzzyScore = function (str, query) {
    str = str.toLowerCase();
    query = query.toLowerCase();

    if (str === query) return 100;
    if (str.indexOf(query) !== -1) return 50 + (query.length / str.length) * 40;

    var score = 0;
    var qIdx = 0;
    for (var i = 0; i < str.length; i++) {
        if (str[i] === query[qIdx]) {
            score++;
            qIdx++;
            if (qIdx === query.length) {
                return 10 + score;
            }
        }
    }
    return 0;
};

PerfDashApp.prototype.selectSearchResult = function (item) {
    this.showSearchDropdown = false;
    if (item.type === "metric") {
        window.open('metric-details.html?jobname=' + this.selectedJobs.join(',') + '&metriccategoryname=' + encodeURIComponent(item.category) + '&metricname=' + encodeURIComponent(item.label), '_blank');
    } else {
        this.selectedPath = item.category;
        this.onPathSelected();
    }
};

PerfDashApp.prototype.onPathSelected = function () {
    if (!this.selectedPath) return;
    var info = this.searchPathMap[this.selectedPath];
    if (!info) return;

    this.onCategorySelected(info.category);
};

PerfDashApp.prototype.jobNameChanged = function () {
    if (!this.selectedJobs || this.selectedJobs.length === 0 || !this.selectedJobs[0]) return;
    this.setURLParameters();
    var app = this;
    var J = this.selectedJobs[0];
    app.allSearchItems = [];
    app.searchPathMap = {};

    if (!app.allData || !app.allData[J]) return;

    app.metricCategoryNames = Object.keys(app.allData[J]).sort();

    angular.forEach(app.metricCategoryNames, function (cat) {
        if (!app.searchPathMap[cat]) {
            app.allSearchItems.push({ type: "category", label: cat, path: cat, category: cat });
            app.searchPathMap[cat] = { category: cat };
        }

        angular.forEach(app.allData[J][cat], function (data, met) {
            if (!app.searchPathMap[met]) {
                app.allSearchItems.push({ type: "metric", label: met, path: met, category: cat });
                app.searchPathMap[met] = { category: cat, metric: met };
            }
        });
    });

    if (app.selectedCategory == undefined || app.metricCategoryNames.indexOf(app.selectedCategory) == -1) {
        app.selectedCategory = app.metricCategoryNames[0];
    }
    app.onCategorySelected(app.selectedCategory);
};

PerfDashApp.prototype.onCategorySelected = function (cat) {
    if (!cat) return;
    this.selectedCategory = cat;
    this.setURLParameters();
    var app = this;

    if (!app.allData) return;

    var metricSet = {};
    angular.forEach(app.selectedJobs, function (jobName) {
        if (app.allData[jobName] && app.allData[jobName][cat]) {
            angular.forEach(app.allData[jobName][cat], function (data, met) {
                metricSet[met] = true;
            });
        }
    });
    app.metricNames = Object.keys(metricSet).sort();

    app.categoryData = {};
    app.selectedSeriesMap = {};

    angular.forEach(app.metricNames, function (met) {
        if (!app.categoryData[met]) app.categoryData[met] = {};
        angular.forEach(app.selectedJobs, function (jobName) {
            if (app.allData[jobName] && app.allData[jobName][cat] && app.allData[jobName][cat][met]) {
                app.categoryData[met][jobName] = app.allData[jobName][cat][met];
            }
        });
    });

    app.buildChartsForCategory(cat);
};

PerfDashApp.prototype.buildChartsForCategory = function (cat) {
    var app = this;
    app.charts = [];

    var origCat = this.metricCategoryName;
    var origMet = this.metricName;

    this.metricCategoryName = cat;

    var globalLabelsSet = {};
    var labelCounts = {};
    angular.forEach(this.metricNames, function (met) {
        var metricLabelsSet = {};
        angular.forEach(app.selectedJobs, function (jobName) {
            app.jobsData[jobName] = app.categoryData[met] && app.categoryData[met][jobName] ? app.categoryData[met][jobName] : null;
            if (app.jobsData[jobName]) {
                var res = app.getData(jobName, app.selectedLabels);
                if (res) {
                    angular.forEach(res, function(point) {
                        if (point.data) {
                            angular.forEach(Object.keys(point.data), function(label) {
                                globalLabelsSet[label] = true;
                                metricLabelsSet[label] = true;
                            });
                        }
                    });
                }
            }
        });
        angular.forEach(Object.keys(metricLabelsSet), function(label) {
            labelCounts[label] = (labelCounts[label] || 0) + 1;
        });
    });
    var globalSeriesLabels = Object.keys(globalLabelsSet).sort().reverse();
    app.allSeriesLabels = globalSeriesLabels;
    app.labelCounts = labelCounts;

    if (!app.selectedSeriesMap || Object.keys(app.selectedSeriesMap).length === 0) {
        app.selectedSeriesMap = {};
        angular.forEach(globalSeriesLabels, function (label) {
            app.selectedSeriesMap[label] = true;
        });
    }

    angular.forEach(this.metricNames, function (met) {
        app.metricName = met;

        var bData = null;
        angular.forEach(app.selectedJobs, function (jobName) {
            if (!bData && app.categoryData[met] && app.categoryData[met][jobName]) {
                bData = app.categoryData[met][jobName];
            }
        });
        if (!bData) return;

        app.data = bData.builds;
        app.job = bData.job;

        var jobResults = {};
        var paddedJobBuildNumbers = {};
        angular.forEach(app.selectedJobs, function (jobName) {
            app.jobsData[jobName] = app.categoryData[met] && app.categoryData[met][jobName] ? app.categoryData[met][jobName] : null;
            if (app.jobsData[jobName]) {
                jobResults[jobName] = app.getData(jobName, app.selectedLabels);

                var builds = Object.keys(app.jobsData[jobName].builds);
                builds.sort(function (a, b) { return parseInt(a) - parseInt(b); });

                while (builds.length < app.maxBuilds) {
                    builds.unshift(null);
                }
                paddedJobBuildNumbers[jobName] = builds;
            }
        });

        app.builds = app.getBuilds();
        app.labels = app.getLabels();
        app.labelChanged();
        app.allSeriesLabels = globalSeriesLabels;

        var chartAvailableLabelsSet = {};
        angular.forEach(app.selectedJobs, function (jobName) {
            var res = jobResults[jobName];
            if (res) {
                angular.forEach(res, function(point) {
                    if (point.data) {
                        angular.forEach(Object.keys(point.data), function(label) {
                            chartAvailableLabelsSet[label] = true;
                        });
                    }
                });
            }
        });
        var chartAvailableLabels = Object.keys(chartAvailableLabelsSet).sort().reverse();

        var selectedLabels = [];
        angular.forEach(chartAvailableLabels, function (label) {
            var selected = true;
            if (app.selectedSeriesMap && app.selectedSeriesMap[label] !== undefined) {
                selected = app.selectedSeriesMap[label];
            }
            if (selected) {
                selectedLabels.push(label);
            }
        });

        if (selectedLabels.length === 0) {
            return;
        }

        var chart = {
            id: cat + '_' + met + '_' + app.selectedJobs.join('_'),
            title: met,
            category: cat,
            metric: met,
            jobResults: jobResults,
            maxBuilds: app.maxBuilds,
            allBuilds: app.builds.slice(),
            allSeriesLabels: chartAvailableLabels,
            selectedSeriesLabels: selectedLabels,
            selectedSeriesMap: app.selectedSeriesMap,
            builds: app.builds,
            options: app.options,
            labelsMap: app.getLabels(),
            selectedLabels: {}
        };
        angular.forEach(chart.labelsMap, function (values, name) {
            var globalVal = app.globalSelectedLabels[name];
            if (globalVal !== undefined && values.indexOf(globalVal) !== -1) {
                chart.selectedLabels[name] = globalVal;
            } else {
                chart.selectedLabels[name] = values[0];
            }
        });


        app.computeChartSeries(chart);
        chart.jobBuildNumbers = paddedJobBuildNumbers;
        chart.onClick = function (data, evt, chartInstance) {
            app.onClickInternal_(data, evt, chart, chartInstance);
        };
        app.charts.push(chart);
    });

    this.updateChartColors();
    this.metricCategoryName = origCat;
    this.metricName = origMet;
};

PerfDashApp.prototype.computeChartSeries = function (chart) {
    var app = this;
    chart.seriesData = [];
    chart.series = [];
    chart.chartColors = [];
    var colorIdx = 0;

    var seriesLabels = chart.selectedSeriesLabels;
    if (!seriesLabels || seriesLabels.length === 0) {
        seriesLabels = chart.allSeriesLabels;
    }

    var validSelectedJobs = [];
    for (var i = 0; i < this.selectedJobs.length; i++) {
        if (this.selectedJobs[i]) validSelectedJobs.push(this.selectedJobs[i]);
    }
    var multiJob = validSelectedJobs.length > 1;

    chart.builds = chart.allBuilds.slice();
    var limit = app.limitBuilds;
    if (limit > 0 && limit < chart.maxBuilds) {
        chart.builds = chart.builds.slice(chart.maxBuilds - limit);
    }



    if (multiJob) {
        angular.forEach(validSelectedJobs, function (jobName, idx) {
            var jobData = app.categoryData[chart.metric] ? app.categoryData[chart.metric][jobName] : null;
            if (!jobData) return;
            app.jobsData[jobName] = jobData;
            var res = app.getData(jobName, chart.selectedLabels);
            angular.forEach(seriesLabels, function (name) {
                var stream = app.getStream(res, name);
                while (stream.length < chart.maxBuilds) {
                    stream.unshift(null);
                }
                var slicedStream = stream;
                if (limit > 0 && limit < chart.maxBuilds) {
                    slicedStream = stream.slice(chart.maxBuilds - limit);
                }
                chart.seriesData.push(slicedStream);

                chart.series.push(jobName + " - " + name);
            });
        });
    } else {
        var jobName = validSelectedJobs[0];
        var jobData = app.categoryData[chart.metric] ? app.categoryData[chart.metric][jobName] : null;
        if (jobData) {
            app.jobsData[jobName] = jobData;
            var res = app.getData(jobName, chart.selectedLabels);
            if (res) {
                angular.forEach(seriesLabels, function (name) {
                    var stream = app.getStream(res, name);
                    while (stream.length < chart.maxBuilds) {
                        stream.unshift(null);
                    }
                    var slicedStream = stream;
                    if (limit > 0 && limit < chart.maxBuilds) {
                        slicedStream = stream.slice(chart.maxBuilds - limit);
                    }
                    chart.seriesData.push(slicedStream);

                    chart.series.push(name);
                });
            }
        }
    }
    var allEmpty = true;
    angular.forEach(chart.seriesData, function (stream) {
        angular.forEach(stream, function (val) {
            if (val !== null) {
                allEmpty = false;
            }
        });
    });
    var hasLabels = Object.keys(chart.labelsMap).length > 0;
    chart.noData = allEmpty && !hasLabels;
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
                var rgb = palette[colorIdx % palette.length];
                colorIdx++;
                app.selectedJobColors[jobName] = "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";

                var alpha = 0.3; // default
                if (app.hoveredJob) {
                    alpha = (jobName === app.hoveredJob) ? 1.0 : 0.05;
                } else if (app.mainJobName) {
                    alpha = (jobName === app.mainJobName) ? 1.0 : 0.3;
                } else if (idx === 0) {
                    alpha = 1.0; // fallback to first job if no main set
                }

                var jobData = app.jobsData[jobName];
                var buildStatus = jobData ? jobData.buildStatus : {};

                angular.forEach(chart.selectedSeriesLabels, function (name) {
                    var colorObj = app.getChartColor(rgb[0], rgb[1], rgb[2], alpha);
                    
                    // Compute per-point colors!
                    var pointColors = [];
                    angular.forEach(chart.builds, function(build) {
                        if (build === null) {
                            pointColors.push("rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + alpha + ")");
                        } else {
                            var status = buildStatus[build];
                            if (status === "FAILURE") {
                                pointColors.push("rgba(255,0,0,1.0)"); // Red for failure!
                            } else {
                                pointColors.push("rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + alpha + ")");
                            }
                        }
                    });
                    colorObj.pointColor = pointColors;
                    
                    chart.chartColors.push(colorObj);
                });
            });
        } else {
            var jobName = validSelectedJobs[0];
            app.selectedJobColors[jobName] = "rgb(" + palette[0][0] + "," + palette[0][1] + "," + palette[0][2] + ")";
            var jobData = app.jobsData[jobName];
            var buildStatus = jobData ? jobData.buildStatus : {};
            var rgb = palette[0]; // Use first color for all series in single job mode!
            angular.forEach(chart.selectedSeriesLabels, function (name) {
                var labelIdx = chart.allSeriesLabels.indexOf(name);
                var alpha = 1.0 - (labelIdx * 0.2);
                if (alpha < 0.2) alpha = 0.2;
                
                var colorObj = app.getChartColor(rgb[0], rgb[1], rgb[2], alpha);
                
                // Compute per-point colors!
                var pointColors = [];
                angular.forEach(chart.builds, function(build) {
                    if (build === null) {
                        pointColors.push("rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + alpha + ")");
                    } else {
                        var status = buildStatus[build];
                        if (status === "FAILURE") {
                            pointColors.push("rgba(255,0,0,1.0)"); // Red for failure!
                        } else {
                            pointColors.push("rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + alpha + ")");
                        }
                    }
                });
                colorObj.pointColor = pointColors;
                
                chart.chartColors.push(colorObj);
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

PerfDashApp.prototype.onLimitBuildsChange = function () {
    var app = this;
    angular.forEach(this.charts, function (chart) {
        app.computeChartSeries(chart);
    });
    this.updateChartColors();
    this.setURLParameters();
};

PerfDashApp.prototype.onHideFailedRunsChange = function () {
    var app = this;
    angular.forEach(this.charts, function (chart) {
        app.computeChartSeries(chart);
    });
    this.updateChartColors();
    this.setURLParameters();
};

PerfDashApp.prototype.onChartLabelChange = function (chart, labelName) {
    var app = this;
    var newVal = chart.selectedLabels[labelName];
    this.globalSelectedLabels[labelName] = newVal;

    if (this.debounceTimeout) {
        this.timeout.cancel(this.debounceTimeout);
    }
    this.debounceTimeout = this.timeout(function () {
        angular.forEach(app.charts, function (c) {
            if (c !== chart && c.labelsMap[labelName]) {
                if (c.labelsMap[labelName].indexOf(newVal) !== -1) {
                    c.selectedLabels[labelName] = newVal;
                    app.computeChartSeries(c);
                }
            }
        });
        app.computeChartSeries(chart);
        app.setURLParameters();
    }, 500);
};

PerfDashApp.prototype.onChartSeriesMapChange = function (chart) {
    chart.selectedSeriesLabels = [];
    angular.forEach(chart.selectedSeriesMap, function (selected, label) {
        if (selected) {
            chart.selectedSeriesLabels.push(label);
        }
    });
    this.chartSeriesCache[chart.metric] = chart.selectedSeriesMap;
    this.computeChartSeries(chart);
    this.updateChartColors();
};

PerfDashApp.prototype.onGlobalSeriesMapChange = function () {
    var app = this;
    if (this.debounceTimeout) {
        this.timeout.cancel(this.debounceTimeout);
    }
    this.debounceTimeout = this.timeout(function () {
        app.buildChartsForCategory(app.selectedCategory);
    }, 500);
};

// Update the data to graph, using selected labels
PerfDashApp.prototype.labelChanged = function () {
    this.setURLParameters();
    this.seriesData = [];
    this.series = [];
    this.options = null;

    this.maxBuilds = 0;
    var allSeriesLabels = [];
    var jobResults = {};
    var jobBuildNumbers = {};
    var app = this;

    angular.forEach(this.selectedJobs, function (jobName) {
        if (!jobName) return;
        var jobData = app.jobsData[jobName];
        if (jobData && jobData.builds) {
            var res = app.getData(jobName, app.selectedLabels);
            jobResults[jobName] = res;
            if (res.length > app.maxBuilds) {
                app.maxBuilds = res.length;
            }

            var builds = Object.keys(jobData.builds);
            builds.sort(function (a, b) { return parseInt(a) - parseInt(b); });
            jobBuildNumbers[jobName] = builds;

            for (var a = 0; a < res.length; a++) {
                if ("unit" in res[a] && "data" in res[a] && res[a].data != {}) {
                    app.options = { scaleLabel: "<%=value%> " + res[a].unit, animation: false, responsive: true, maintainAspectRatio: false };
                    allSeriesLabels = allSeriesLabels.concat(Object.keys(res[a].data));
                }
            }
        }
    });

    this.jobBuildNumbers = jobBuildNumbers;

    var seriesLabelsSet = {};
    for (var k = 0; k < allSeriesLabels.length; k++) {
        seriesLabelsSet[allSeriesLabels[k]] = true;
    }
    this.allSeriesLabels = Object.keys(seriesLabelsSet);
    this.allSeriesLabels.sort();
    this.allSeriesLabels.reverse();

    var seriesLabels = this.allSeriesLabels.slice();

    var validSelectedJobs = [];
    for (var i = 0; i < this.selectedJobs.length; i++) {
        if (this.selectedJobs[i]) validSelectedJobs.push(this.selectedJobs[i]);
    }
    var multiJob = validSelectedJobs.length > 1;

    if (this.selectedSeriesLabels && this.selectedSeriesLabels.length > 0) {
        var filtered = [];
        for (var m = 0; m < seriesLabels.length; m++) {
            if (this.selectedSeriesLabels.indexOf(seriesLabels[m]) !== -1) {
                filtered.push(seriesLabels[m]);
            }
        }
        if (filtered.length > 0) seriesLabels = filtered;
    } else if (multiJob) {
        var reduced = [];
        for (var m = 0; m < seriesLabels.length; m++) {
            if (seriesLabels[m] === "Perc50" || seriesLabels[m] === "Average") {
                reduced.push(seriesLabels[m]);
            }
        }
        if (reduced.length > 0) seriesLabels = reduced;
    }

    if (this.options == null) return;

    this.builds = [];
    for (var i = 0; i < this.maxBuilds; i++) {
        this.builds.push("Run " + (i + 1));
    }

    var validSelectedJobs = [];
    for (var i = 0; i < this.selectedJobs.length; i++) {
        if (this.selectedJobs[i]) validSelectedJobs.push(this.selectedJobs[i]);
    }
    var multiJob = validSelectedJobs.length > 1;

    var palette = [
        [56, 189, 248],  // Blue
        [129, 140, 248], // Purple
        [52, 211, 153],  // Green
        [248, 113, 113], // Red
        [250, 204, 21],  // Yellow
        [156, 163, 175]  // Grey
    ];

    function getChartColor(r, g, b) {
        return {
            fillColor: "rgba(" + r + "," + g + "," + b + ",0.2)",
            strokeColor: "rgba(" + r + "," + g + "," + b + ",1)",
            pointColor: "rgba(" + r + "," + g + "," + b + ",1)",
            pointStrokeColor: "#fff",
            pointHighlightFill: "#fff",
            pointHighlightStroke: "rgba(" + r + "," + g + "," + b + ",1)"
        };
    }

    this.chartColors = [];
    this.selectedJobColors = {};
    var colorIdx = 0;

    if (multiJob) {
        angular.forEach(validSelectedJobs, function (jobName) {
            var res = jobResults[jobName];
            if (!res) return;

            var rgb = palette[colorIdx % palette.length];
            colorIdx++;
            app.selectedJobColors[jobName] = "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";

            angular.forEach(seriesLabels, function (name) {
                var stream = app.getStream(res, name);
                while (stream.length < this.maxBuilds) {
                    stream.push(null);
                }
                app.seriesData.push(stream);
                app.chartColors.push(getChartColor(rgb[0], rgb[1], rgb[2]));
                app.series.push(jobName + " - " + name);
            });
        });
    } else {
        var jobName = validSelectedJobs[0];
        var res = jobResults[jobName];
        app.selectedJobColors[jobName] = "rgb(" + palette[0][0] + "," + palette[0][1] + "," + palette[0][2] + ")";
        if (res) {
            angular.forEach(seriesLabels, function (name) {
                var stream = app.getStream(res, name);
                while (stream.length < this.maxBuilds) {
                    stream.push(null);
                }
                app.seriesData.push(stream);

                var rgb = palette[colorIdx % palette.length];
                colorIdx++;

                app.chartColors.push(getChartColor(rgb[0], rgb[1], rgb[2]));
                app.series.push(name);
            });
        }
    }
    this.cap = 0;
};

// Overwrite the URL query params with the current drop-down selections.
PerfDashApp.prototype.setURLParameters = function () {
    var newParams = {};
    angular.forEach(this.route.current.params, function (ignore, name) {
        newParams[name] = null;
    });
    var validJobs = [];
    for (var i = 0; i < this.selectedJobs.length; i++) {
        if (this.selectedJobs[i]) validJobs.push(this.selectedJobs[i]);
    }
    newParams["jobname"] = validJobs.join(",");
    newParams["metriccategoryname"] = this.selectedCategory;
    newParams["limitbuilds"] = this.limitBuilds;
    angular.forEach(this.globalSelectedLabels, function (value, name) {
        newParams[name] = value;
    });
    if (this.selectedSeriesLabels && this.selectedSeriesLabels.length > 0) {
        newParams["selectedserieslabels"] = this.selectedSeriesLabels.join(",");
    }
    this.route.updateParams(newParams);
}

PerfDashApp.prototype.getMetricDetailsUrl = function (chart) {
    var jobs = this.selectedJobs.join(',');
    var cat = encodeURIComponent(chart.category);
    var met = encodeURIComponent(chart.metric);
    return 'metric-details.html?jobname=' + jobs + '&metriccategoryname=' + cat + '&metricname=' + met;
};

// Get all of the builds for the data set (e.g. build numbers)
PerfDashApp.prototype.getBuilds = function () {
    return this.builds || [];
};

// Verify if selected labels are in label set.
function verifySelectedLabels(selectedLabels, allLabels) {
    if (selectedLabels == undefined || allLabels == undefined) {
        return false;
    }

    if (Object.keys(selectedLabels).length != Object.keys(allLabels).length) {
        return false;
    }

    var result = true;
    angular.forEach(selectedLabels, function (value, key) {
        if (!(key in allLabels) || !(value in allLabels[key])) {
            result = false;
        }
    });

    return result;
}

function isEmptySet(obj) {
    var count = 0;
    for (k in obj) {
        if (obj.hasOwnProperty(k)) {
            count++;
        }
    }
    if (count == 0) {
        return true
    }
    if (count == 1) {
        if (obj.hasOwnProperty("")) {
            return true
        }
    }
    return false
}

// Get the set of all labels (e.g. 'resources', 'verbs') in the data set
PerfDashApp.prototype.getLabels = function () {
    var set = {};
    angular.forEach(this.jobsData, function (jobData) {
        if (!jobData || !jobData.builds) return;
        angular.forEach(jobData.builds, function (items, build) {
            angular.forEach(items, function (item) {
                angular.forEach(item.labels, function (label, name) {
                    if (set[name] == undefined) {
                        set[name] = {}
                    }
                    set[name][label] = true
                });
            });
        });
    });

    angular.forEach(set, function (labels, name) {
        if (isEmptySet(labels)) {
            delete set[name]
        }
    });
    if (!verifySelectedLabels(this.selectedLabels, set)) {
        this.selectedLabels = {}
    }
    var labels = {};
    angular.forEach(set, function (items, name) {
        labels[name] = [];
        angular.forEach(items, function (ignore, item) {
            if (this.selectedLabels[name] == undefined) {
                this.selectedLabels[name] = item;
            }
            labels[name].push(item)
        }, this);
        labels[name].sort()
    }, this);
    return labels;
};

// Extract a time series of data for specific labels
PerfDashApp.prototype.getData = function (jobName, labels) {
    var result = [];
    var jobData = this.jobsData[jobName];
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

// Given a slice of data, turn it into a time series of numbers
// 'data' is an array of APICallLatency objects
// 'stream' is a selector for latency data, (e.g. 'Perc50')
PerfDashApp.prototype.getStream = function (data, stream) {
    var result = [];
    angular.forEach(data, function (value) {
        var x = undefined
        if (value && value.failed) {
            x = null;
        } else if ("data" in value) {
            x = value.data[stream];
        }
        //This is a handling for undefined values which cause chart.js to not display plots
        //TODO(krzysied): Check whether new version of chart.js has support for this case
        if (x == undefined) {
            x = 0;
        }
        if (this.cap != 0 && x > this.cap) {
            x = this.cap;
        }
        result.push(x);
    }, this);
    return result;
};

app.controller('AppCtrl', ['$scope', '$http', '$interval', '$route', '$timeout', function ($scope, $http, $interval, $route, $timeout) {
    $scope.controller = new PerfDashApp($http, $scope, $route, $timeout);
    $scope.controller.refresh();

    // Refresh every 10 min.  The data only refreshes every 10 minutes on the server
    $interval($scope.controller.refresh.bind($scope.controller), 600000)
}]);

// Add a dummy route so that we can manipulate URL params.
app.config(function ($routeProvider) {
    $routeProvider.when('/', { reloadOnSearch: false })
});
