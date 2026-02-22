# `serve` Script

We need to add another nodejs script to the project. This time the script will be responsible for executing the srtla_send command. Here is what we're currently using:

```
./srtla_send 6000 your-server.com 5000 /tmp/ips.txt
```

And here is the URL I have put into OBS:

```
srt://127.0.0.1:6000?mode=caller&streamid=[secret]
```

## Requirements

- Add a config.json file to the project. Here we will keep the configuration:
  - `srtOutputDomain`
  - `srtOutputPort`
  - `srtInputPort`
- When the script runs it should run the `./srtla_send` command with the configuration set.
- Assume the script runs in the same directory as `./srtla_send` and `ips.txt`.
- Wrap the script so that if it crashes it is automatically restarted.
  - Use an exponential backoff strategy when restarting the process.
  - Put a cap of 15 seconds maximum time between tries.
- Add new scripts to the `package.json`
  - `npm run get-ips`
  - `npm run serve`
  - `npm run start` - this runs `get-ips` and then runs `serve`
