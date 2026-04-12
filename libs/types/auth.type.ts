export interface AuthenticatedRequest {
  user: {
    _id: string;
    usr_id: string;
    usr_fullname: string;
    usr_email: string;
    usr_phone: string;
    usr_avatar: string;
    usr_gender: string;
    usr_status: string;
    usr_slug: string;
    usr_dateOfBirth: string;
    createdAt: string;
    updatedAt: string;
    jti: string;
    [key: string]: any;
  };
}
