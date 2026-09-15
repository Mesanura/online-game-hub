# 像素忍战音效

复制自用户提供的 `D:\temp\400 Sounds Pack`，保留 WAV 原始内容。该目录未附独立许可证；此处记录来源，不新增或推定许可条款。

| 文件                | 原目录          | 用途                            |
| ------------------- | --------------- | ------------------------------- |
| sword_light.wav     | Weapons         | 挥刀                            |
| sword_clash_2.wav   | Weapons         | 拼刀金属撞击                    |
| jump_short.wav      | Retro           | 跳跃                            |
| air_burst.wav       | Environment     | 蹬墙跳                          |
| concrete_scrape.wav | Materials       | 滑行摩擦（播放前 0.3 秒并淡出） |
| crunch_quick.wav    | Combat and Gore | 击杀确认                        |

素材随 Surface 构建内嵌，解码为 Web Audio buffer，不发起额外 fetch；保留 iframe 的 `connect-src 'none'` 约束。音量、淡出、混音与限幅由音频模块控制，不改写原音频。
