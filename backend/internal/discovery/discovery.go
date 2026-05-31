package discovery

import (
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type File struct {
	Path    string
	ModTime time.Time
	Size    int64
}

func LatestJSONL(roots []string, limit int) []File {
	files := make([]File, 0)
	for _, root := range roots {
		walkJSONL(root, &files, 8, 0)
	}
	sort.Slice(files, func(i, j int) bool {
		return files[i].ModTime.After(files[j].ModTime)
	})
	if limit > 0 && len(files) > limit {
		return files[:limit]
	}
	return files
}

func ReadTail(path string, maxBytes int64) ([]byte, error) {
	stat, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if stat.Size() <= 0 {
		return []byte{}, nil
	}
	start := stat.Size() - maxBytes
	if start < 0 {
		start = 0
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	if _, err := file.Seek(start, io.SeekStart); err != nil {
		return nil, err
	}
	data, err := io.ReadAll(file)
	if err != nil {
		return nil, err
	}
	if start > 0 {
		if idx := strings.IndexByte(string(data), '\n'); idx >= 0 {
			data = data[idx+1:]
		}
	}
	return data, nil
}

func walkJSONL(root string, out *[]File, maxDepth int, depth int) {
	if root == "" || depth > maxDepth {
		return
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return
	}
	for _, entry := range entries {
		full := filepath.Join(root, entry.Name())
		if entry.IsDir() {
			walkJSONL(full, out, maxDepth, depth+1)
			continue
		}
		if !entry.Type().IsRegular() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}
		stat, err := entry.Info()
		if err != nil {
			continue
		}
		*out = append(*out, File{Path: full, ModTime: stat.ModTime(), Size: stat.Size()})
	}
}
