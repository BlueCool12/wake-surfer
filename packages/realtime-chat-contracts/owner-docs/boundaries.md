# @wake-surfer/realtime-chat-contracts 경계

여기서 소유하는 것:

- public socket event shape
- public HTTP/process DTO shape
- outbound delivery event shape
- public integration event shape
- public error code name
- public contract에서 사용하는 primitive alias

여기서 소유하지 않는 것:

- API application commands
- gateway usecase inputs
- repository ports
- persistence models
- session registry state
- domain policies
- permission decisions beyond public error names

타입이 client/process boundary를 넘지 않는다면 이 패키지에 두지 않습니다.
