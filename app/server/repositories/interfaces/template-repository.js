export class TemplateRepository {
  async list() {
    throw new Error("TemplateRepository.list is not implemented.");
  }

  async getById(_templateId) {
    throw new Error("TemplateRepository.getById is not implemented.");
  }

  async save(_template) {
    throw new Error("TemplateRepository.save is not implemented.");
  }

  async archive(_templateId) {
    throw new Error("TemplateRepository.archive is not implemented.");
  }

  async markUsed(_templateId) {
    throw new Error("TemplateRepository.markUsed is not implemented.");
  }

  async importIfMissing(_template) {
    throw new Error("TemplateRepository.importIfMissing is not implemented.");
  }
}
