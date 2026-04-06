export class TurnRepository {
  async upsertTurns(_session, _turns = []) {
    throw new Error("TurnRepository.upsertTurns is not implemented.");
  }

  async listBySessionId(_sessionId) {
    throw new Error("TurnRepository.listBySessionId is not implemented.");
  }
}
