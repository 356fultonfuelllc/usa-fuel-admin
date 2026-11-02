#!/bin/sh
# Run before publishing: writes version.json so browsers load the new scripts right away.
cd "$(dirname "$0")"
v=$(cat *.js pages/*.js | shasum | cut -c1-10)
files=$(ls *.js pages/*.js | sed 's/.*/"&"/' | paste -sd, -)
printf '{"v":"%s","files":[%s]}\n' "$v" "$files" > version.json
echo "version $v"
