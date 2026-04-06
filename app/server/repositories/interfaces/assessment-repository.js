export class AssessmentRepository {
  async upsertAssessments(_session, _turns = []) {
    throw new Error("AssessmentRepository.upsertAssessments is not implemented.");
  }

  async listBySessionId(_sessionId) {
    throw new Error("AssessmentRepository.listBySessionId is not implemented.");
  }
}
