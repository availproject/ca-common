#!/bin/bash

protoc --plugin="./node_modules/.bin/protoc-gen-ts_proto" --ts_proto_out="./src/proto" --proto_path="./src/proto" --ts_proto_opt="esModuleInterop=true,forceLong=long,useOptionals=messages,oneof=unions-value,outputClientImpl=grpc-web" src/proto/*.proto
