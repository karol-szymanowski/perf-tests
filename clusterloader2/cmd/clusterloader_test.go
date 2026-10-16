/*
Copyright The Kubernetes Authors.

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

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"k8s.io/perf-tests/clusterloader2/api"
	"k8s.io/perf-tests/clusterloader2/pkg/config"
	"k8s.io/perf-tests/clusterloader2/pkg/test"
)

type dumpTestContext struct {
	test.Context
	clusterLoaderConfig *config.ClusterLoaderConfig
	testScenario        *api.TestScenario
}

func (c *dumpTestContext) GetClusterLoaderConfig() *config.ClusterLoaderConfig {
	return c.clusterLoaderConfig
}

func (c *dumpTestContext) GetTestScenario() *api.TestScenario {
	return c.testScenario
}

func TestDumpTestConfigUsesScenarioIdentifier(t *testing.T) {
	reportDir := t.TempDir()
	clusterLoaderConfig := &config.ClusterLoaderConfig{ReportDir: reportDir}
	testConfig := &api.Config{Name: "density"}

	for _, identifier := range []string{"vanilla", "pod-affinity"} {
		ctx := &dumpTestContext{
			clusterLoaderConfig: clusterLoaderConfig,
			testScenario:        &api.TestScenario{Identifier: identifier},
		}
		if err := dumpTestConfig(ctx, testConfig); err != nil {
			t.Fatalf("dumpTestConfig() error = %v", err)
		}
	}

	for _, identifier := range []string{"vanilla", "pod-affinity"} {
		filePath := filepath.Join(reportDir, "generatedConfig_density_"+identifier+".yaml")
		if _, err := os.Stat(filePath); err != nil {
			t.Errorf("expected config artifact %q: %v", filePath, err)
		}
	}
}

func TestReportSetupFailureWritesJUnit(t *testing.T) {
	reportDir := t.TempDir()
	junitPath := filepath.Join(reportDir, "junit.xml")
	reporter := test.CreateSimpleReporter(junitPath, "ClusterLoaderV2")
	reporter.BeginTestSuite()

	setupErr := fmt.Errorf("Error while setting up prometheus stack: waiting for Prometheus stack to become healthy")
	reportSetupFailure(reporter, "prometheus", "SetUpPrometheusStack", 2*time.Minute, setupErr)

	if got := reporter.GetNumberOfFailedTestItems(); got != 1 {
		t.Fatalf("GetNumberOfFailedTestItems() = %d, want 1", got)
	}

	content, err := os.ReadFile(junitPath)
	if err != nil {
		t.Fatalf("expected junit.xml at %q: %v", junitPath, err)
	}
	xmlStr := string(content)
	for _, want := range []string{
		`name="prometheus overall (SetUpPrometheusStack)"`,
		`classname="ClusterLoaderV2"`,
		"Error while setting up prometheus stack: waiting for Prometheus stack to become healthy",
	} {
		if !strings.Contains(xmlStr, want) {
			t.Errorf("junit.xml missing %q; got:\n%s", want, xmlStr)
		}
	}
}
