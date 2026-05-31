FROM golang:1.24-bookworm

WORKDIR /app

RUN go install github.com/air-verse/air@v1.63.0

COPY go.mod go.sum ./
RUN go mod download

COPY . .

CMD ["air", "-c", ".air.toml"]
