const PodAmenity = require("../models/PodAmenity");
const Pod = require("../models/Pod");

class PodAmenityService {
  async createAmenity(data) {
    const { pod_id, name, value } = data;
    const pod = await Pod.findOne({ id: pod_id });
    if (!pod) {
      const error = new Error("Pod not found");
      error.statusCode = 404;
      throw error;
    }

    return PodAmenity.create({ pod_id, name, value: value ?? null });
  }

  async getAllAmenities(filters = {}) {
    const query = {};
    if (filters.pod_id) query.pod_id = filters.pod_id;
    if (filters.name) query.name = new RegExp(filters.name, "i");

    return PodAmenity.find(query).sort({ createdAt: -1 });
  }

  async getAmenityById(id) {
    const amenity = await PodAmenity.findOne({ id });
    if (!amenity) {
      const error = new Error("Pod amenity not found");
      error.statusCode = 404;
      throw error;
    }
    return amenity;
  }

  async updateAmenity(id, data) {
    const amenity = await this.getAmenityById(id);

    if (data.name !== undefined) amenity.name = data.name;
    if (data.value !== undefined) amenity.value = data.value;

    await amenity.save();
    return amenity;
  }

  async deleteAmenity(id) {
    await this.getAmenityById(id);
    await PodAmenity.deleteOne({ id });
    return { message: "Pod amenity deleted successfully" };
  }
}

module.exports = new PodAmenityService();
