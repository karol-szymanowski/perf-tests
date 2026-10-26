/*
Copyright 2019 The Kubernetes Authors.

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
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"k8s.io/client-go/kubernetes"
	restclient "k8s.io/client-go/rest"
	"k8s.io/perf-tests/clusterloader2/pkg/config"
	prom "k8s.io/perf-tests/clusterloader2/pkg/prometheus/clients"
)

func TestVerifySnapshotName(t *testing.T) {
	tests := []struct {
		name    string
		isValid bool
	}{
		{"disk-name", true},
		{"disk_name", false},
		{"disk12345", true},
		{"123242345", false},
	}

	for _, test := range tests {
		err := VerifySnapshotName(test.name)
		if test.isValid != (err == nil) {
			t.Errorf("Incorrect validation result of %s, got: %v, want: %v",
				test.name, (err == nil), test.isValid)
		}
	}
}

func TestValidatePrometheusFlagsUseExisting(t *testing.T) {
	t.Cleanup(func() { prom.ConfigureInClusterProxy(prom.DefaultProxyScheme, prom.DefaultServiceName) })

	tests := []struct {
		name    string
		cfg     config.PrometheusConfig
		wantErr bool
	}{
		{
			name: "defaults",
			cfg:  config.PrometheusConfig{ProxyScheme: "http", ServiceName: "prometheus-k8s"},
		},
		{
			name: "use existing https",
			cfg: config.PrometheusConfig{
				UseExistingServer: true,
				ProxyScheme:       "https",
				ServiceName:       "prometheus-k8s-shard-0",
			},
		},
		{
			name: "both enable and use existing",
			cfg: config.PrometheusConfig{
				EnableServer:      true,
				UseExistingServer: true,
				ProxyScheme:       "http",
			},
			wantErr: true,
		},
		{
			name:    "bad scheme",
			cfg:     config.PrometheusConfig{ProxyScheme: "ftp"},
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			errList := ValidatePrometheusFlags(&tc.cfg)
			gotErr := !errList.IsEmpty()
			if gotErr != tc.wantErr {
				t.Fatalf("ValidatePrometheusFlags() error=%v (%s), wantErr=%v", gotErr, errList.String(), tc.wantErr)
			}
			if tc.wantErr {
				return
			}
			if got := prom.InClusterProxyScheme(); got != tc.cfg.ProxyScheme {
				t.Errorf("scheme = %q, want %q", got, tc.cfg.ProxyScheme)
			}
			if tc.cfg.ServiceName != "" && prom.InClusterServiceName() != tc.cfg.ServiceName {
				t.Errorf("service = %q, want %q", prom.InClusterServiceName(), tc.cfg.ServiceName)
			}
		})
	}
}

func TestCheckTargetsReady(t *testing.T) {
	t.Cleanup(func() { prom.ConfigureInClusterProxy(prom.DefaultProxyScheme, prom.DefaultServiceName) })
	prom.ConfigureInClusterProxy("http", "prometheus-k8s")

	tests := []struct {
		name             string
		handler          http.HandlerFunc
		minActiveTargets int
		minReadyTargets  int
		wantReady        bool
		wantErr          bool
	}{
		{
			name: "all expected targets are up",
			handler: func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				w.Write([]byte(`{
					"status": "success",
					"data": {
						"activeTargets": [
							{"labels": {"job": "prometheus"}, "health": "up"},
							{"labels": {"job": "apiserver"}, "health": "up"}
						]
					}
				}`))
			},
			minActiveTargets: 2,
			minReadyTargets:  2,
			wantReady:        true,
			wantErr:          false,
		},
		{
			name: "targets not all up returns false, nil",
			handler: func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				w.Write([]byte(`{
					"status": "success",
					"data": {
						"activeTargets": [
							{"labels": {"job": "prometheus"}, "health": "up"},
							{"labels": {"job": "apiserver"}, "health": "down"}
						]
					}
				}`))
			},
			minActiveTargets: 2,
			minReadyTargets:  2,
			wantReady:        false,
			wantErr:          false,
		},
		{
			name: "not enough active targets returns false, nil",
			handler: func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				w.Write([]byte(`{
					"status": "success",
					"data": {
						"activeTargets": [
							{"labels": {"job": "prometheus"}, "health": "up"}
						]
					}
				}`))
			},
			minActiveTargets: 2,
			minReadyTargets:  2,
			wantReady:        false,
			wantErr:          false,
		},
		{
			name: "corrupted JSON returns false, nil to allow polling retry",
			handler: func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				w.Write([]byte(`{"status": "success", "data": {"activeTargets": [corrupted`))
			},
			minActiveTargets: 2,
			minReadyTargets:  2,
			wantReady:        false,
			wantErr:          false,
		},
		{
			name: "truncated stream / mid-stream connection reset returns false, nil",
			handler: func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				if hj, ok := w.(http.Hijacker); ok {
					conn, bufrw, err := hj.Hijack()
					if err == nil {
						bufrw.WriteString("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"data\":{\"activeTargets\":[")
						bufrw.Flush()
						conn.Close()
						return
					}
				}
				w.Write([]byte(`{"data":{"activeTargets":[`))
			},
			minActiveTargets: 2,
			minReadyTargets:  2,
			wantReady:        false,
			wantErr:          false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(tc.handler)
			defer server.Close()

			cfg := &restclient.Config{
				Host: server.URL,
			}
			client, err := kubernetes.NewForConfig(cfg)
			if err != nil {
				t.Fatalf("failed to create client: %v", err)
			}

			ready, err := CheckTargetsReady(context.Background(), client, func(Target) bool { return true }, tc.minActiveTargets, tc.minReadyTargets, true)
			if (err != nil) != tc.wantErr {
				t.Fatalf("CheckTargetsReady() error = %v, wantErr %v", err, tc.wantErr)
			}
			if ready != tc.wantReady {
				t.Errorf("CheckTargetsReady() ready = %v, wantReady %v", ready, tc.wantReady)
			}

			allReady, err := CheckAllTargetsReady(context.Background(), client, func(Target) bool { return true }, tc.minActiveTargets, true)
			if (err != nil) != tc.wantErr {
				t.Fatalf("CheckAllTargetsReady() error = %v, wantErr %v", err, tc.wantErr)
			}
			if allReady != tc.wantReady {
				t.Errorf("CheckAllTargetsReady() ready = %v, wantReady %v", allReady, tc.wantReady)
			}
		})
	}
}

