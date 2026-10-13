/*
Copyright 2026 The Kubernetes Authors.

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

package prometheus

import (
	"bytes"
	"os"
	"strings"
	"testing"

	template "github.com/google/safetext/yamltemplate"
	"gopkg.in/yaml.v2"
	"k8s.io/perf-tests/clusterloader2/pkg/config"
)

func renderPrometheusManifest(t *testing.T, mapping map[string]interface{}) (string, error) {
	t.Helper()
	rawBytes, err := ReadManifest("prometheus-prometheus.yaml")
	if err != nil {
		return "", err
	}
	tmpl, err := template.New("prometheus-prometheus.yaml").Funcs(config.GetFuncs(manifestsFS)).Parse(string(rawBytes))
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, mapping); err != nil {
		return "", err
	}
	return buf.String(), nil
}

func TestRenderPrometheusManifestDefaults(t *testing.T) {
	mapping := map[string]interface{}{
		"Nodes": 5000,
	}

	rendered, err := renderPrometheusManifest(t, mapping)
	if err != nil {
		t.Fatalf("failed to render manifest: %v", err)
	}

	var parsed map[string]interface{}
	if err := yaml.Unmarshal([]byte(rendered), &parsed); err != nil {
		t.Fatalf("failed to parse rendered YAML: %v\nRendered:\n%s", err, rendered)
	}

	tp := config.NewTemplateProvider(manifestsFS)
	if _, err := tp.TemplateToObject("prometheus-prometheus.yaml", mapping); err != nil {
		t.Fatalf("TemplateToObject failed: %v", err)
	}

	expectedStrings := []string{
		"baseImage: gcr.io/k8s-testimages/quay.io/prometheus/prometheus",
		"version: v3.15.0",
		"scrapeFallbackProtocol: PrometheusText0.0.4",
		"memory: 12Gi",
		"storage: 60Gi",
		"timeout: 2m",
		"maxConcurrency: 20",
		"retention: 7d",
	}
	for _, expected := range expectedStrings {
		if !strings.Contains(rendered, expected) {
			t.Errorf("expected rendered YAML to contain %q, but got:\n%s", expected, rendered)
		}
	}

	// Verify that limits.cpu is not emitted by default
	if limits, ok := parsed["spec"].(map[interface{}]interface{})["resources"].(map[interface{}]interface{})["limits"].(map[interface{}]interface{}); ok {
		if _, hasCPU := limits["cpu"]; hasCPU {
			t.Errorf("limits.cpu should not be set by default, but found in limits: %v", limits)
		}
	}
	if strings.Contains(rendered, "retentionSize:") {
		t.Errorf("expected rendered YAML NOT to contain 'retentionSize:' by default, but got:\n%s", rendered)
	}
}

func TestRenderPrometheusManifestCustomParams(t *testing.T) {
	mapping := map[string]interface{}{
		"Nodes":                              9000,
		"CL2_PROMETHEUS_IMAGE":               "quay.io/prometheus/prometheus:v3.15.0",
		"CL2_PROMETHEUS_MEMORY_LIMIT_FACTOR": 32,
		"CL2_PROMETHEUS_CPU_SCALE_FACTOR":    10,
		"CL2_PROMETHEUS_PVC_SIZE_FACTOR":     40,
		"CL2_PROMETHEUS_QUERY_TIMEOUT":       "10m",
		"CL2_PROMETHEUS_RETENTION_SIZE":      "350GB",
	}

	rendered, err := renderPrometheusManifest(t, mapping)
	if err != nil {
		t.Fatalf("failed to render manifest: %v", err)
	}

	var parsed map[string]interface{}
	if err := yaml.Unmarshal([]byte(rendered), &parsed); err != nil {
		t.Fatalf("failed to parse rendered YAML: %v\nRendered:\n%s", err, rendered)
	}

	tp := config.NewTemplateProvider(manifestsFS)
	if _, err := tp.TemplateToObject("prometheus-prometheus.yaml", mapping); err != nil {
		t.Fatalf("TemplateToObject failed: %v", err)
	}

	expectedStrings := []string{
		"image: quay.io/prometheus/prometheus:v3.15.0",
		"memory: 320Gi",
		"storage: 400Gi",
		"timeout: 10m",
		"scrapeFallbackProtocol",
		"retentionSize: 350GB",
	}
	for _, expected := range expectedStrings {
		if !strings.Contains(rendered, expected) {
			t.Errorf("expected rendered YAML to contain %q, but got:\n%s", expected, rendered)
		}
	}

	if strings.Contains(rendered, "baseImage:") {
		t.Errorf("expected rendered YAML NOT to contain 'baseImage:' when image is specified, got:\n%s", rendered)
	}
}

func TestRenderPrometheusManifest20kNodes(t *testing.T) {
	// GKE 20k job params: Nodes=9000 (simulated nodes count passed to CL2) and CL2_PROMETHEUS_MEMORY_LIMIT_FACTOR=18
	// With the new tunables:
	mapping := map[string]interface{}{
		"Nodes":                              9000,
		"CL2_PROMETHEUS_IMAGE":               "quay.io/prometheus/prometheus:v3.15.0",
		"CL2_PROMETHEUS_MEMORY_LIMIT_FACTOR": 18,
		"CL2_PROMETHEUS_CPU_SCALE_FACTOR":    10,
		"CL2_PROMETHEUS_PVC_SIZE_FACTOR":     40,
		"CL2_PROMETHEUS_QUERY_TIMEOUT":       "10m",
		"CL2_PROMETHEUS_RETENTION_SIZE":      "350GB",
	}

	rendered, err := renderPrometheusManifest(t, mapping)
	if err != nil {
		t.Fatalf("failed to render manifest: %v", err)
	}

	var parsed map[string]interface{}
	if err := yaml.Unmarshal([]byte(rendered), &parsed); err != nil {
		t.Fatalf("failed to parse rendered YAML: %v\nRendered:\n%s", err, rendered)
	}

	tmpFile := "/tmp/rendered_20k.yaml"
	if err := os.WriteFile(tmpFile, []byte(rendered), 0644); err != nil {
		t.Fatalf("failed to write rendered yaml: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Remove(tmpFile)
	})
	t.Logf("Rendered 20k manifest written to %s", tmpFile)
}
