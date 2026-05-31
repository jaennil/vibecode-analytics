package discovery

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLatestJSONLSortsAndLimits(t *testing.T) {
	dir := t.TempDir()
	oldFile := filepath.Join(dir, "old.jsonl")
	newFile := filepath.Join(dir, "nested", "new.jsonl")
	if err := os.MkdirAll(filepath.Dir(newFile), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(oldFile, []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(newFile, []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	oldTime := time.Now().Add(-time.Hour)
	newTime := time.Now()
	if err := os.Chtimes(oldFile, oldTime, oldTime); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(newFile, newTime, newTime); err != nil {
		t.Fatal(err)
	}

	files := LatestJSONL([]string{dir}, 1)
	if len(files) != 1 || files[0].Path != newFile {
		t.Fatalf("files=%+v", files)
	}
}

func TestReadTailDropsPartialFirstLine(t *testing.T) {
	file := filepath.Join(t.TempDir(), "session.jsonl")
	if err := os.WriteFile(file, []byte("partial\n{\"ok\":true}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	data, err := ReadTail(file, 13)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "{\"ok\":true}\n" {
		t.Fatalf("tail=%q", data)
	}
}
