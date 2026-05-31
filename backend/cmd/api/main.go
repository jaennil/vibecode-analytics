package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"live-token-monitor/internal/config"
	"live-token-monitor/internal/httpapi"
	"live-token-monitor/internal/service"
	"live-token-monitor/internal/store"
)

func main() {
	cfg := config.Load()
	st, err := store.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer st.Close()

	svc := service.New(cfg, st)
	handler := httpapi.New(svc, cfg.CORSOrigins)
	addr := fmt.Sprintf("127.0.0.1:%d", cfg.Port)
	if inContainer() {
		addr = fmt.Sprintf("0.0.0.0:%d", cfg.Port)
	}
	log.Printf("Live token monitor API: http://%s", addr)
	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatal(err)
	}
}

func inContainer() bool {
	return os.Getenv("BIND_ALL") == "1"
}
